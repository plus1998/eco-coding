# Cursor ACP 图片发送 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 Composer 图片附件编成 ACP `{ type: "image", mimeType, data }` 送进 Cursor `session/prompt`；覆盖首条和排队后续，能力不足或附件非法时明确失败。

**Architecture:** Runtime 纯函数 `buildAcpPromptBlocks` 负责组块和门禁。`AcpAgentDriver` 在 handshake 后按 `promptCapabilities.image === true` 组块。Desktop 把 `attachments` 从 coordinator / drain 传到 `startAcpThreadRun`；ACP 后续一律 `force_queue` 且必须把 attachments 写入排队行。

**Tech Stack:** TypeScript, Bun tests, Cursor CLI `agent acp`（本机 `2026.08.11-e8db854` 已验证收图）。

**Spec:** [docs/superpowers/specs/2026-08-17-acp-cursor-image-prompt-design.md](../specs/2026-08-17-acp-cursor-image-prompt-design.md)

## Global Constraints

- 图块字段名是 `mimeType`（camelCase），不是 `mime_type`。
- `imageSupported` 仅当 `agentCapabilities.promptCapabilities.image === true`。
- 有附件但未声明 image：抛 `Cursor ACP 未声明图片输入能力，无法发送附件。`，不调用 `session/prompt`。
- 附件缺 data / mime 非法：抛 `ACP 图片附件无效：缺少 data 或 mimeType 不受支持。`
- 失败不降级成纯文本重试。
- 纯图默认文案：`请查看并分析我附上的图片。`
- 允许的 mime：`image/jpeg` | `image/png` | `image/gif` | `image/webp`。
- ACP 后续仍 `force_queue`；escalate / 轮次中插入仍拒绝。
- 不做音频、embeddedContext、落盘 uri、CI 真机 `agent acp`。
- 用户未明确要求时不要 git commit。
- TDD：每个行为先失败测试再实现。

---

## File map

| File | Responsibility |
|------|----------------|
| Create `packages/runtime/src/acp-prompt.ts` | 附件类型、错误文案、能力判断、组块 |
| Create `packages/runtime/test/acp-prompt.test.ts` | 组块与门禁纯函数测 |
| Modify `packages/runtime/src/acp-agent-driver.ts` | `attachments` 入参；handshake 后组块再 `session/prompt` |
| Modify `packages/runtime/test/acp-agent-driver.test.ts` | 带图 prompt；`image: false` 不发 prompt |
| Modify `packages/runtime/src/index.ts` | 导出 `acp-prompt` |
| Modify `apps/desktop/src/shared/thread-follow-up-core.ts` | 去掉 `reject_attachments` / `assertAcpFollowUpTextOnly` |
| Modify `apps/desktop/test/thread-follow-up-core.test.ts` | ACP 带图改为 `force_queue` |
| Modify `apps/desktop/src/shared/i18n-catalogs.ts` | 删旧 key；加两条新错误 |
| Modify `apps/desktop/test/i18n-catalogs.test.ts` | 同步测例 |
| Modify `apps/desktop/src/main/acp-runtime-run.ts` | 透传 attachments；纯图 prompt helper |
| Modify `apps/desktop/test/resolve-acp-thread-agent-id.test.ts` | helper 测例 |
| Modify `apps/desktop/src/main/index.ts` | coordinator / continuation / enqueue / update |

---

### Task 1: `buildAcpPromptBlocks` 纯函数

**Files:**
- Create: `packages/runtime/src/acp-prompt.ts`
- Create: `packages/runtime/test/acp-prompt.test.ts`
- Modify: `packages/runtime/src/index.ts`（在 `export * from "./acp-host-ui-features.js"` 旁增加 `export * from "./acp-prompt.js"`）

**Interfaces:**
- Consumes: 无
- Produces:

```ts
export const ACP_IMAGE_ONLY_PROMPT = "请查看并分析我附上的图片。";
export const ACP_IMAGE_CAPABILITY_MISSING = "Cursor ACP 未声明图片输入能力，无法发送附件。";
export const ACP_IMAGE_ATTACHMENT_INVALID = "ACP 图片附件无效：缺少 data 或 mimeType 不受支持。";
export const ACP_PROMPT_EMPTY = "ACP prompt is empty";

export type AcpPromptImageAttachment = {
  mediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
  data: string;
};

export type AcpPromptContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; mimeType: AcpPromptImageAttachment["mediaType"]; data: string };

export function agentSupportsImagePrompt(initializeResult: {
  agentCapabilities?: { promptCapabilities?: unknown };
}): boolean;

export function buildAcpPromptBlocks(input: {
  prompt: string;
  attachments?: readonly AcpPromptImageAttachment[];
  imageSupported: boolean;
}): AcpPromptContentBlock[];
```

- [ ] **Step 1: Write the failing test**

Create `packages/runtime/test/acp-prompt.test.ts`:

```ts
import { expect, test } from "bun:test";
import {
  ACP_IMAGE_ATTACHMENT_INVALID,
  ACP_IMAGE_CAPABILITY_MISSING,
  ACP_IMAGE_ONLY_PROMPT,
  ACP_PROMPT_EMPTY,
  agentSupportsImagePrompt,
  buildAcpPromptBlocks,
} from "../src/acp-prompt.js";

const png = { mediaType: "image/png" as const, data: "abc" };

test("agentSupportsImagePrompt is true only for image === true", () => {
  expect(agentSupportsImagePrompt({ agentCapabilities: { promptCapabilities: { image: true } } })).toBe(true);
  expect(agentSupportsImagePrompt({ agentCapabilities: { promptCapabilities: { image: false } } })).toBe(false);
  expect(agentSupportsImagePrompt({ agentCapabilities: { promptCapabilities: {} } })).toBe(false);
  expect(agentSupportsImagePrompt({})).toBe(false);
  expect(agentSupportsImagePrompt({ agentCapabilities: { promptCapabilities: { image: "true" } } })).toBe(false);
});

test("buildAcpPromptBlocks returns a single text block when there are no attachments", () => {
  expect(buildAcpPromptBlocks({ prompt: "  hello  ", imageSupported: false })).toEqual([
    { type: "text", text: "hello" },
  ]);
});

test("buildAcpPromptBlocks throws when prompt and attachments are both empty", () => {
  expect(() => buildAcpPromptBlocks({ prompt: "  ", imageSupported: true })).toThrow(ACP_PROMPT_EMPTY);
});

test("buildAcpPromptBlocks prepends text then image blocks in input order", () => {
  expect(
    buildAcpPromptBlocks({
      prompt: "look",
      attachments: [png, { mediaType: "image/jpeg", data: "def" }],
      imageSupported: true,
    }),
  ).toEqual([
    { type: "text", text: "look" },
    { type: "image", mimeType: "image/png", data: "abc" },
    { type: "image", mimeType: "image/jpeg", data: "def" },
  ]);
});

test("buildAcpPromptBlocks uses the default look-at-image sentence when text is empty", () => {
  expect(buildAcpPromptBlocks({ prompt: "", attachments: [png], imageSupported: true })).toEqual([
    { type: "text", text: ACP_IMAGE_ONLY_PROMPT },
    { type: "image", mimeType: "image/png", data: "abc" },
  ]);
});

test("buildAcpPromptBlocks throws when attachments exist but image is unsupported", () => {
  expect(() =>
    buildAcpPromptBlocks({ prompt: "look", attachments: [png], imageSupported: false }),
  ).toThrow(ACP_IMAGE_CAPABILITY_MISSING);
});

test("buildAcpPromptBlocks throws for blank data or illegal mime", () => {
  expect(() =>
    buildAcpPromptBlocks({
      prompt: "look",
      attachments: [{ mediaType: "image/png", data: "  " }],
      imageSupported: true,
    }),
  ).toThrow(ACP_IMAGE_ATTACHMENT_INVALID);
  expect(() =>
    buildAcpPromptBlocks({
      prompt: "look",
      attachments: [{ mediaType: "image/svg+xml" as "image/png", data: "abc" }],
      imageSupported: true,
    }),
  ).toThrow(ACP_IMAGE_ATTACHMENT_INVALID);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/runtime/test/acp-prompt.test.ts`

Expected: FAIL — `Cannot find module` / `acp-prompt` 不存在。

- [ ] **Step 3: Write minimal implementation**

Create `packages/runtime/src/acp-prompt.ts`:

```ts
export const ACP_IMAGE_ONLY_PROMPT = "请查看并分析我附上的图片。";
export const ACP_IMAGE_CAPABILITY_MISSING = "Cursor ACP 未声明图片输入能力，无法发送附件。";
export const ACP_IMAGE_ATTACHMENT_INVALID = "ACP 图片附件无效：缺少 data 或 mimeType 不受支持。";
export const ACP_PROMPT_EMPTY = "ACP prompt is empty";

const ALLOWED_MEDIA_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

export type AcpPromptImageAttachment = {
  mediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
  data: string;
};

export type AcpPromptContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; mimeType: AcpPromptImageAttachment["mediaType"]; data: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function agentSupportsImagePrompt(initializeResult: {
  agentCapabilities?: { promptCapabilities?: unknown };
}): boolean {
  const caps = initializeResult.agentCapabilities?.promptCapabilities;
  return isRecord(caps) && caps.image === true;
}

export function buildAcpPromptBlocks(input: {
  prompt: string;
  attachments?: readonly AcpPromptImageAttachment[];
  imageSupported: boolean;
}): AcpPromptContentBlock[] {
  const text = input.prompt.trim();
  const attachments = input.attachments ?? [];
  if (attachments.length === 0) {
    if (!text) {
      throw new Error(ACP_PROMPT_EMPTY);
    }
    return [{ type: "text", text }];
  }
  if (!input.imageSupported) {
    throw new Error(ACP_IMAGE_CAPABILITY_MISSING);
  }
  const images: AcpPromptContentBlock[] = [];
  for (const attachment of attachments) {
    const data = attachment.data.trim();
    if (!data || !ALLOWED_MEDIA_TYPES.has(attachment.mediaType)) {
      throw new Error(ACP_IMAGE_ATTACHMENT_INVALID);
    }
    images.push({
      type: "image",
      mimeType: attachment.mediaType,
      data,
    });
  }
  return [{ type: "text", text: text || ACP_IMAGE_ONLY_PROMPT }, ...images];
}
```

在 `packages/runtime/src/index.ts` 增加：

```ts
export * from "./acp-prompt.js";
```

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `bun test packages/runtime/test/acp-prompt.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**（仅当用户要求）

```bash
git add packages/runtime/src/acp-prompt.ts packages/runtime/test/acp-prompt.test.ts packages/runtime/src/index.ts
git commit -m "feat(acp): 把图片附件编成 session/prompt content blocks"
```

---

### Task 2: Driver 把附件送进 `session/prompt`

**Files:**
- Modify: `packages/runtime/src/acp-agent-driver.ts`
- Modify: `packages/runtime/test/acp-agent-driver.test.ts`

**Interfaces:**
- Consumes: `buildAcpPromptBlocks`, `agentSupportsImagePrompt`, `AcpPromptImageAttachment` from `acp-prompt.ts`
- Produces: `AcpAgentRunInput.attachments?: readonly AcpPromptImageAttachment[]`

- [ ] **Step 1: Write the failing tests**

在 `packages/runtime/test/acp-agent-driver.test.ts` 的 `describe("AcpAgentDriver"` 内、现有第一个 test 之后追加：

```ts
  test("run: image attachments become ACP image content blocks", async () => {
    const fake = createFakeAcpChild();
    const { AcpAgentDriver } = await import("../src/acp-agent-driver.js");
    const driver = new AcpAgentDriver({ spawnFn: () => fake.child });

    const eventsPromise = (async () => {
      const out = [];
      for await (const event of driver.run({
        threadId: "thr_img",
        prompt: "look",
        workspacePath: "/tmp/ws",
        acpAgentId: "cursor",
        attachments: [{ mediaType: "image/png", data: "abc" }],
      })) {
        out.push(event);
      }
      return out;
    })();

    await waitFor(() => fake.parseWritten().some((m) => m.method === "initialize"));
    const initReq = fake.parseWritten().find((m) => m.method === "initialize")!;
    fake.emitLine({ jsonrpc: "2.0", id: initReq.id, result: INIT_RESULT });

    await waitFor(() => fake.parseWritten().some((m) => m.method === "session/new"));
    const newReq = fake.parseWritten().find((m) => m.method === "session/new")!;
    fake.emitLine({ jsonrpc: "2.0", id: newReq.id, result: { sessionId: "sess-img" } });

    await waitFor(() => fake.parseWritten().some((m) => m.method === "session/prompt"));
    const promptReq = fake.parseWritten().find((m) => m.method === "session/prompt")!;
    expect(promptReq.params).toEqual({
      sessionId: "sess-img",
      prompt: [
        { type: "text", text: "look" },
        { type: "image", mimeType: "image/png", data: "abc" },
      ],
    });

    fake.emitLine({ jsonrpc: "2.0", id: promptReq.id, result: { stopReason: "end_turn" } });
    await eventsPromise;
  });

  test("run: attachments fail the turn when initialize does not advertise image", async () => {
    const fake = createFakeAcpChild();
    const { AcpAgentDriver } = await import("../src/acp-agent-driver.js");
    const driver = new AcpAgentDriver({ spawnFn: () => fake.child });

    const eventsPromise = (async () => {
      const out = [];
      for await (const event of driver.run({
        threadId: "thr_noimg",
        prompt: "look",
        workspacePath: "/tmp/ws",
        acpAgentId: "cursor",
        attachments: [{ mediaType: "image/png", data: "abc" }],
      })) {
        out.push(event);
      }
      return out;
    })();

    await waitFor(() => fake.parseWritten().some((m) => m.method === "initialize"));
    const initReq = fake.parseWritten().find((m) => m.method === "initialize")!;
    fake.emitLine({
      jsonrpc: "2.0",
      id: initReq.id,
      result: {
        protocolVersion: 1,
        agentCapabilities: { loadSession: true, promptCapabilities: { image: false } },
      },
    });

    await waitFor(() => fake.parseWritten().some((m) => m.method === "session/new"));
    const newReq = fake.parseWritten().find((m) => m.method === "session/new")!;
    fake.emitLine({ jsonrpc: "2.0", id: newReq.id, result: { sessionId: "sess-noimg" } });

    const events = await eventsPromise;
    expect(fake.parseWritten().some((m) => m.method === "session/prompt")).toBe(false);
    const terminal = events.find((e) => e.type === "run.terminal");
    expect(terminal?.payload).toEqual({
      status: "failed",
      error: "Cursor ACP 未声明图片输入能力，无法发送附件。",
    });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/runtime/test/acp-agent-driver.test.ts`

Expected: FAIL — `attachments` 不是 `AcpAgentRunInput` 的字段；现有 prompt 仍只有 text。

- [ ] **Step 3: Write minimal implementation**

`packages/runtime/src/acp-agent-driver.ts`：

1. 增加 import：

```ts
import {
  agentSupportsImagePrompt,
  buildAcpPromptBlocks,
  type AcpPromptImageAttachment,
} from "./acp-prompt.js";
```

2. `AcpAgentRunInput` 增加：

```ts
  attachments?: readonly AcpPromptImageAttachment[];
```

3. 保存 initialize 结果。把现有 handshake：

```ts
      const handshake = (async () => {
        await client.initialize();
        client.confInitialized();
      })();
      await Promise.race([handshake, spawnFailure]);
```

改成：

```ts
      let initializeResult: Awaited<ReturnType<typeof client.initialize>> | undefined;
      const handshake = (async () => {
        initializeResult = await client.initialize();
        client.confInitialized();
      })();
      await Promise.race([handshake, spawnFailure]);
      if (!initializeResult) {
        throw new Error("ACP initialize returned no result");
      }
```

4. 把 `client.prompt({ sessionId, prompt: [{ type: "text", text: input.prompt }] })` 换成：

```ts
          const prompt = buildAcpPromptBlocks({
            prompt: input.prompt,
            imageSupported: agentSupportsImagePrompt(initializeResult),
            ...(input.attachments?.length ? { attachments: input.attachments } : {}),
          });
          const result = await client.prompt({
            sessionId,
            prompt,
          });
```

`buildAcpPromptBlocks` 必须在 `promptWork` 里、`client.prompt` 之前调用。抛错走现有 `run.terminal` failed 分支。不要在 catch 里改成纯文本重试。

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `bun test packages/runtime/test/acp-agent-driver.test.ts packages/runtime/test/acp-prompt.test.ts`

Expected: PASS（含原有 handshake / load / cancel 测例）

- [ ] **Step 5: Commit**（仅当用户要求）

```bash
git add packages/runtime/src/acp-agent-driver.ts packages/runtime/test/acp-agent-driver.test.ts
git commit -m "feat(acp): 按 handshake 能力把图片送进 session/prompt"
```

---

### Task 3: 排队后续允许带图；i18n

**Files:**
- Modify: `apps/desktop/src/shared/thread-follow-up-core.ts`
- Modify: `apps/desktop/test/thread-follow-up-core.test.ts`
- Modify: `apps/desktop/src/shared/i18n-catalogs.ts`
- Modify: `apps/desktop/test/i18n-catalogs.test.ts`

**Interfaces:**
- Consumes: 无
- Produces:
  - `AcpFollowUpEnqueuePlan = { kind: "default" } | { kind: "force_queue" }`（删除 `reject_attachments`）
  - 删除 `ACP_FOLLOW_UP_ATTACHMENTS_UNSUPPORTED`、`assertAcpFollowUpTextOnly`
  - `resolveAcpFollowUpEnqueuePlan`：ACP 一律 `force_queue`，不再看 `attachmentCount`
  - i18n 删除 `native.acpFollowUpAttachmentsUnsupported`
  - i18n 新增：
    - `native.acpImageCapabilityMissing`
    - `native.acpImageAttachmentInvalid`

- [ ] **Step 1: Write the failing tests**

`apps/desktop/test/thread-follow-up-core.test.ts` 整文件改成：

```ts
import { expect, test } from "bun:test";
import { expectedIpcErrorKey } from "../src/shared/i18n-catalogs";
import {
  ACP_FOLLOW_UP_ESCALATE_UNSUPPORTED,
  assertAcpFollowUpEscalateAllowed,
  coreSupportsFollowUpEscalate,
  coreSupportsMidTurnFollowUp,
  resolveAcpFollowUpEnqueuePlan,
  resolveFollowUpDeliveryModeForCore,
  shouldForceQueuedFollowUp,
} from "../src/shared/thread-follow-up-core";

test("coreSupportsMidTurnFollowUp is only Claude and Codex", () => {
  expect(coreSupportsMidTurnFollowUp("claude")).toBe(true);
  expect(coreSupportsMidTurnFollowUp("codex")).toBe(true);
  expect(coreSupportsMidTurnFollowUp("acp")).toBe(false);
  expect(coreSupportsMidTurnFollowUp("pi")).toBe(false);
  expect(coreSupportsMidTurnFollowUp(undefined)).toBe(false);
});

test("ACP follow-up cannot escalate or steer", () => {
  expect(coreSupportsFollowUpEscalate("acp")).toBe(false);
  expect(coreSupportsFollowUpEscalate("claude")).toBe(true);
  expect(shouldForceQueuedFollowUp("acp")).toBe(true);
  expect(shouldForceQueuedFollowUp("claude")).toBe(false);
  expect(resolveFollowUpDeliveryModeForCore("acp", "steer")).toBe("queue");
  expect(resolveFollowUpDeliveryModeForCore("acp", "queue")).toBe("queue");
  expect(resolveFollowUpDeliveryModeForCore("claude", "steer")).toBe("steer");
});

test("ACP enqueue plan force-queues text and attachments", () => {
  expect(resolveAcpFollowUpEnqueuePlan({ coreKind: "claude", attachmentCount: 0 })).toEqual({
    kind: "default",
  });
  expect(resolveAcpFollowUpEnqueuePlan({ coreKind: "acp", attachmentCount: 0 })).toEqual({
    kind: "force_queue",
  });
  expect(
    resolveAcpFollowUpEnqueuePlan({
      coreKind: "acp",
      attachmentCount: 1,
    }),
  ).toEqual({ kind: "force_queue" });
});

test("ACP follow-up escalate still throws; attachments no longer throw at enqueue", () => {
  expect(() => assertAcpFollowUpEscalateAllowed("acp")).toThrow(ACP_FOLLOW_UP_ESCALATE_UNSUPPORTED);
  expect(() => assertAcpFollowUpEscalateAllowed("claude")).not.toThrow();
  expect(expectedIpcErrorKey(ACP_FOLLOW_UP_ESCALATE_UNSUPPORTED)).toBe(
    "native.acpFollowUpEscalateUnsupported",
  );
});
```

`apps/desktop/test/i18n-catalogs.test.ts` 把 `ACP follow-up IPC errors` 测例改成：

```ts
test("ACP follow-up IPC errors localize without raw Chinese in en-US", () => {
  const messages = [
    "Cursor ACP 不支持中断当前轮次插入后续消息；消息会在本轮结束后发送。",
    "Cursor ACP 未声明图片输入能力，无法发送附件。",
    "ACP 图片附件无效：缺少 data 或 mimeType 不受支持。",
  ];
  for (const message of messages) {
    const key = expectedIpcErrorKey(message);
    expect(key).toBeDefined();
    expect(translateCatalog("en-US", key!)).not.toMatch(/[\u3400-\u9fff]/);
  }
});
```

不要再断言 `Cursor ACP 暂不支持带图后续消息。`。

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test apps/desktop/test/thread-follow-up-core.test.ts apps/desktop/test/i18n-catalogs.test.ts`

Expected: FAIL — ACP + 附件仍是 `reject_attachments`；新错误没有 i18n key。

- [ ] **Step 3: Write minimal implementation**

`apps/desktop/src/shared/thread-follow-up-core.ts` 全文：

```ts
import type { FollowUpDeliveryMode } from "./ipc";

export const ACP_FOLLOW_UP_ESCALATE_UNSUPPORTED =
  "Cursor ACP 不支持中断当前轮次插入后续消息；消息会在本轮结束后发送。";

export type AcpFollowUpEnqueuePlan = { kind: "default" } | { kind: "force_queue" };

export function coreSupportsMidTurnFollowUp(
  coreKind: string | undefined,
): coreKind is "claude" | "codex" {
  return coreKind === "claude" || coreKind === "codex";
}

export function coreSupportsFollowUpEscalate(coreKind: string | undefined): boolean {
  return coreSupportsMidTurnFollowUp(coreKind);
}

export function shouldForceQueuedFollowUp(coreKind: string | undefined): boolean {
  return coreKind === "acp";
}

export function resolveFollowUpDeliveryModeForCore(
  coreKind: string | undefined,
  requested: FollowUpDeliveryMode,
): FollowUpDeliveryMode {
  return coreSupportsMidTurnFollowUp(coreKind) ? requested : "queue";
}

export function resolveAcpFollowUpEnqueuePlan(input: {
  coreKind?: string | undefined;
  attachmentCount: number;
}): AcpFollowUpEnqueuePlan {
  if (input.coreKind !== "acp") {
    return { kind: "default" };
  }
  return { kind: "force_queue" };
}

export function assertAcpFollowUpEscalateAllowed(coreKind: string | undefined): void {
  if (coreKind === "acp") {
    throw new Error(ACP_FOLLOW_UP_ESCALATE_UNSUPPORTED);
  }
}
```

`attachmentCount` 参数保留（调用方仍传入），但不再用于分支，避免本次同时改所有调用点签名。

`apps/desktop/src/shared/i18n-catalogs.ts`：

1. 删除 zh/en 的 `"native.acpFollowUpAttachmentsUnsupported"`。
2. 在 `"native.acpFollowUpEscalateUnsupported"` 旁增加：

zh-CN:

```ts
      "native.acpImageCapabilityMissing": "Cursor ACP 未声明图片输入能力，无法发送附件。",
      "native.acpImageAttachmentInvalid": "ACP 图片附件无效：缺少 data 或 mimeType 不受支持。",
```

en-US:

```ts
      "native.acpImageCapabilityMissing":
        "Cursor ACP did not advertise image prompt support; attachments cannot be sent.",
      "native.acpImageAttachmentInvalid":
        "ACP image attachment is invalid: missing data or unsupported mime type.",
```

3. `expectedIpcErrorKey`：删除对 `Cursor ACP 暂不支持带图后续消息。` 的分支；增加：

```ts
  if (message === "Cursor ACP 未声明图片输入能力，无法发送附件。") {
    return "native.acpImageCapabilityMissing";
  }
  if (message === "ACP 图片附件无效：缺少 data 或 mimeType 不受支持。") {
    return "native.acpImageAttachmentInvalid";
  }
```

`apps/desktop/src/main/index.ts`：

1. import 去掉 `assertAcpFollowUpTextOnly`，保留 `assertAcpFollowUpEscalateAllowed` 与 `resolveAcpFollowUpEnqueuePlan`。
2. `threadFollowUpEnqueue`：删除整个

```ts
    if (enqueuePlan.kind === "reject_attachments") {
      assertAcpFollowUpTextOnly({
        coreKind: thread.coreKind,
        attachmentCount: request.attachments?.length ?? 0,
      });
    }
```

3. 同一函数里把

```ts
      ...(!forceQueue && request.attachments?.length ? { attachments: request.attachments } : {}),
```

改成

```ts
      ...(request.attachments?.length ? { attachments: request.attachments } : {}),
```

`forceQueue` 时仍不要写 `priority`（现有 `!forceQueue && request.priority` 保持）。这是必须改的缺口：不改则 ACP 排队会把图扔掉。

4. `threadFollowUpUpdate`：删除 `assertAcpFollowUpTextOnly({...})` 调用。
5. `startAcpThreadContinuation`：删除开头的 `assertAcpFollowUpTextOnly({...})`。空 prompt 检查先保持 `input.prompt.trim()`（纯图默认文案在 Task 4 补）。不删这个调用的话，去掉 import 后本任务无法编译。

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `bun test apps/desktop/test/thread-follow-up-core.test.ts apps/desktop/test/i18n-catalogs.test.ts`

Expected: PASS。`index.ts` 去掉 `assertAcpFollowUpTextOnly` 后应能通过 typecheck；若还有引用，编译会失败，删干净。

- [ ] **Step 5: Commit**（仅当用户要求）

```bash
git add apps/desktop/src/shared/thread-follow-up-core.ts apps/desktop/test/thread-follow-up-core.test.ts apps/desktop/src/shared/i18n-catalogs.ts apps/desktop/test/i18n-catalogs.test.ts apps/desktop/src/main/index.ts
git commit -m "feat(acp): 允许排队后续带图并去掉拒绝文案"
```

---

### Task 4: Desktop 把 attachments 传到 ACP run

**Files:**
- Modify: `apps/desktop/src/main/acp-runtime-run.ts`
- Modify: `apps/desktop/test/resolve-acp-thread-agent-id.test.ts`
- Modify: `apps/desktop/src/main/index.ts`

**Interfaces:**
- Consumes: `AcpPromptImageAttachment` / `ACP_IMAGE_ONLY_PROMPT` from `@eco/runtime`；Desktop `PromptImageAttachment` 结构兼容
- Produces:

```ts
export function toAcpThreadStartRunInput(input: {
  thread: AcpThreadStartRunInput["thread"];
  workspace: AcpThreadStartRunInput["workspace"];
  prompt: string;
  attachments?: PromptImageAttachment[];
  continuation?: boolean;
}): AcpThreadStartRunInput;

export function resolveAcpRunPrompt(input: {
  prompt: string;
  attachments?: readonly PromptImageAttachment[];
}): string;
```

`AcpThreadStartRunInput.attachments?: PromptImageAttachment[]`

`startAcpThreadRun` 把 attachments 传给 `driver.run`。

- [ ] **Step 1: Write the failing tests**

在 `apps/desktop/test/resolve-acp-thread-agent-id.test.ts` 增加 import 与测例：

```ts
import { ACP_IMAGE_ONLY_PROMPT } from "@eco/runtime";
import {
  decideAcpResume,
  isAcpLoadSessionFailure,
  resolveAcpRunPrompt,
  toAcpThreadStartRunInput,
} from "../src/main/acp-runtime-run";
```

（保留原有 `resolveAcpThreadAgentId` import。）

```ts
test("toAcpThreadStartRunInput forwards attachments on start and continuation", () => {
  const attachments = [{ mediaType: "image/png" as const, data: "abc" }];
  const thread = { id: "thr_1" } as Parameters<typeof toAcpThreadStartRunInput>[0]["thread"];
  const workspace = { path: "/tmp/ws" } as Parameters<typeof toAcpThreadStartRunInput>[0]["workspace"];
  expect(
    toAcpThreadStartRunInput({ thread, workspace, prompt: "look", attachments }).attachments,
  ).toEqual(attachments);
  expect(
    toAcpThreadStartRunInput({
      thread,
      workspace,
      prompt: "look",
      attachments,
      continuation: true,
    }).continuation,
  ).toBe(true);
  expect(toAcpThreadStartRunInput({ thread, workspace, prompt: "look" }).attachments).toBeUndefined();
});

test("resolveAcpRunPrompt fills the default look-at-image sentence", () => {
  expect(resolveAcpRunPrompt({ prompt: "  hi  " })).toBe("hi");
  expect(
    resolveAcpRunPrompt({ prompt: "  ", attachments: [{ mediaType: "image/png", data: "abc" }] }),
  ).toBe(ACP_IMAGE_ONLY_PROMPT);
  expect(resolveAcpRunPrompt({ prompt: "   " })).toBe("");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test apps/desktop/test/resolve-acp-thread-agent-id.test.ts`

Expected: FAIL — `toAcpThreadStartRunInput` / `resolveAcpRunPrompt` 未导出。

- [ ] **Step 3: Write minimal implementation**

`apps/desktop/src/main/acp-runtime-run.ts`：

1. import：

```ts
import { ACP_IMAGE_ONLY_PROMPT, ACP_LOAD_SESSION_UNSUPPORTED, AcpAgentDriver, type AgentEvent } from "@eco/runtime";
import type { PromptImageAttachment, ThreadSummary, WorkspaceInfo } from "../shared/ipc";
```

（`ThreadSummary` / `WorkspaceInfo` 若已从 ipc 导入则合并。）

2. `AcpThreadStartRunInput` 增加 `attachments?: PromptImageAttachment[]`。

3. 新增：

```ts
export function toAcpThreadStartRunInput(input: {
  thread: AcpThreadStartRunInput["thread"];
  workspace: AcpThreadStartRunInput["workspace"];
  prompt: string;
  attachments?: PromptImageAttachment[];
  continuation?: boolean;
}): AcpThreadStartRunInput {
  return {
    thread: input.thread,
    workspace: input.workspace,
    prompt: input.prompt,
    ...(input.attachments?.length ? { attachments: input.attachments } : {}),
    ...(input.continuation ? { continuation: true } : {}),
  };
}

export function resolveAcpRunPrompt(input: {
  prompt: string;
  attachments?: readonly PromptImageAttachment[];
}): string {
  const text = input.prompt.trim();
  if (text) return text;
  if (input.attachments && input.attachments.length > 0) {
    return ACP_IMAGE_ONLY_PROMPT;
  }
  return "";
}
```

4. `startAcpThreadRun` 里 `driver.run({...})` 增加：

```ts
          ...(input.attachments?.length ? { attachments: input.attachments } : {}),
```

`apps/desktop/src/main/index.ts`：

1. 从 `./acp-runtime-run` 的 import 增加 `toAcpThreadStartRunInput`、`resolveAcpRunPrompt`（若当前是 `import { cancelAcpThread, startAcpThreadRun }`，改成一并导入）。

2. ACP coordinator `start` 从：

```ts
  start: (input) =>
    void startAcpThreadRun(
      { thread: input.thread, workspace: input.workspace, prompt: input.prompt },
      acpRuntimeOrchestrationDeps(),
    ),
```

改成：

```ts
  start: (input) =>
    void startAcpThreadRun(
      toAcpThreadStartRunInput({
        thread: input.thread,
        workspace: input.workspace,
        prompt: input.prompt,
        ...(input.attachments?.length ? { attachments: input.attachments } : {}),
      }),
      acpRuntimeOrchestrationDeps(),
    ),
```

3. `startAcpThreadContinuation` 整段开头改成：

```ts
async function startAcpThreadContinuation(
  input: StartThreadContinuationInput,
): Promise<ThreadContinueResult> {
  const prompt = resolveAcpRunPrompt({
    prompt: input.prompt,
    ...(input.attachments?.length ? { attachments: input.attachments } : {}),
  });
  if (!prompt) {
    throw new Error("Message is required.");
  }
```

删除 `assertAcpFollowUpTextOnly`（Task 3 若已删 import，这里不应再调用）。

`void startAcpThreadRun(...)` 改成：

```ts
  void startAcpThreadRun(
    toAcpThreadStartRunInput({
      thread: updated,
      workspace,
      prompt,
      continuation: true,
      ...(input.attachments?.length ? { attachments: input.attachments } : {}),
    }),
    acpRuntimeOrchestrationDeps(),
  );
```

`recordUserPrompt` 仍传 `input.attachments`（现有行为）。

- [ ] **Step 4: Run the tests and make sure they pass**

Run:

```
bun test packages/runtime/test/acp-prompt.test.ts packages/runtime/test/acp-agent-driver.test.ts apps/desktop/test/resolve-acp-thread-agent-id.test.ts apps/desktop/test/thread-follow-up-core.test.ts apps/desktop/test/i18n-catalogs.test.ts
```

Expected: PASS

再确认 `index.ts` 已无 `assertAcpFollowUpTextOnly` / `ACP_FOLLOW_UP_ATTACHMENTS_UNSUPPORTED` / `reject_attachments`。

- [ ] **Step 5: Commit**（仅当用户要求）

```bash
git add apps/desktop/src/main/acp-runtime-run.ts apps/desktop/test/resolve-acp-thread-agent-id.test.ts apps/desktop/src/main/index.ts
git commit -m "feat(acp): 首条和续跑把图片附件传给 Cursor ACP"
```

---

## 验收（非 CI）

本机已用 `agent acp` 验证 1×1 PNG 的 `{ type: "image", mimeType, data }` 会被接受。实现后 Desktop 冒烟：

1. 新建 Cursor ACP 线程，贴一张 png 发送 → Feed 有预览，模型按图回复（不是只看到文字）。
2. 运行中再贴图发送 → 进入排队，不出现「暂不支持带图后续消息」。
3. 本轮结束后 drain → 后续带图发出。
4. escalate 仍提示不能打断当前轮次。

---

## Spec coverage

| Spec 项 | Task |
|---------|------|
| `buildAcpPromptBlocks` 组块 / 默认文案 / 非法附件 | Task 1 |
| `image === true` 门禁 | Task 1 + 2 |
| Driver `session/prompt` 带 image blocks | Task 2 |
| 能力不足不发 prompt、terminal failed | Task 2 |
| 删除 `reject_attachments` / `assertAcpFollowUpTextOnly` | Task 3 |
| `force_queue` 仍写入 attachments | Task 3（index enqueue spread） |
| 新 i18n 错误；删除旧 attachments-unsupported | Task 3 |
| escalate 不变 | Task 3 |
| 首条透传 attachments | Task 4 |
| continuation 纯图 + 透传 attachments | Task 4 |
| 不降级纯文本重试 | Task 1–2（无 fallback 路径） |
| 真机冒烟非 CI | 验收节 |
