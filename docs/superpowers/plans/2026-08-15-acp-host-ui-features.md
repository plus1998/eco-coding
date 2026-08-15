# ACP 宿主 UI 功能对照表 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按 `acpAgentId` 用一张 UI 对照表隐藏 Cursor 线程的上下文和计费；桌面 Composer、会话信息浮层、移动端上下文环都只读下发后的 `hostUiFeatures`。

**Architecture:** Runtime 持有唯一对照表。`resolveAcpHostUiFeatures` 从 `coreKind` + `acpAgentId` 现算；`normalizeAcpHostUiFeatures` 消化脏 JSON。`rowToThread` / 建线程把它写进 `ThreadSummary.hostUiFeatures`（不入库）。UI 用 `isAcpHostUiFeatureVisible`，禁止再写 `acpAgentId === "cursor"`。

**Tech Stack:** TypeScript, Bun tests, React `renderToStaticMarkup`, Flutter widget tests。

**Spec:** [docs/superpowers/specs/2026-08-15-acp-host-ui-features-design.md](../specs/2026-08-15-acp-host-ui-features-design.md)

## Global Constraints

- 运行时能力继续走 `ACP_CORE_CAPABILITIES`；本表只描述宿主 UI 藏什么。
- MVP 两列：`contextUsage`、`billing`。Cursor 均为 `hide`。
- 非 `acp`、未知 / 缺 `acpAgentId`：全 `show`。不默认藏。
- `resolveAcpHostUiFeatures` / `normalizeAcpHostUiFeatures` **不抛**。Agent 起不来仍由现有 `Unsupported acpAgentId` 负责。
- `hostUiFeatures` **不入库**。读线程时现算。
- `hide` 含空占位（「费用累计中…」「暂无上下文数据」）。不为 hide 列造 fallback 快照。
- 真实用量若以后入库，表为 `hide` 时仍不展示；不删账本。
- 不实现 `usage_update` 映射；不关 ContextWindowMonitor / 计费编排整条管道。
- 不把标题重生成等现有 `coreKind !== "acp"` 迁进这张表。
- UI 禁止写 `acpAgentId === "cursor"`。
- TypeScript 字段用 `hostUiFeatures?:`，避免几十处测试字面量爆掉；生产路径（`rowToThread`、建线程、remote list）必须始终写入。UI 经 `normalize` 后缺省为全 `show`。
- 用户未明确要求时不要 git commit。
- TDD：每个行为先失败测试再实现。

---

## File map

| File | Responsibility |
|------|----------------|
| Create `packages/runtime/src/acp-host-ui-features.ts` | 对照表 + `resolve` / `normalize` / `isAcpHostUiFeatureVisible` |
| Create `packages/runtime/test/acp-host-ui-features.test.ts` | 表查询与 JSON 回落 |
| Modify `packages/runtime/src/index.ts` | `export * from "./acp-host-ui-features.js"` |
| Modify `apps/desktop/src/shared/ipc.ts` | `ThreadSummary.hostUiFeatures?` |
| Modify `apps/desktop/src/main/conversation-store.ts` | `rowToThread` 现算并写入 |
| Modify `apps/desktop/src/main/index.ts` | 建线程时写入 |
| Modify `apps/desktop/src/main/remote-thread-list.ts` | list RPC 带上 `hostUiFeatures`（体积很小；省略会导致移动端 merge 成全 show） |
| Modify `apps/desktop/src/shared/thread-usage-summary.ts` | hide 列不造 fallback；面板可见性 helper |
| Modify `apps/desktop/src/renderer/ComposerThreadUsagePills.tsx` | 按列藏 pill |
| Modify `apps/desktop/src/renderer/ThreadInfoPanel.tsx` | `ThreadInfoFloatStack` 按列藏；`showContextFloat` 不再恒 true |
| Modify `apps/desktop/src/renderer/App.tsx` | 把 `hostUiFeatures` 传进 summary 与 Composer pills |
| Create `apps/mobile/lib/core/models/acp_host_ui_features.dart` | 只 normalize JSON，不复制 Cursor 表 |
| Modify `apps/mobile/lib/core/models/thread_models.dart` | `ThreadSummary.hostUiFeatures` + merge |
| Modify `apps/mobile/lib/features/composer/composer_controls.dart` | 环 / sheet 按列藏 |
| Modify `apps/mobile/lib/features/composer/session_composer.dart` | 把 features 传给 `ComposerRouteSummary` |
| Modify `apps/mobile/lib/features/threads/thread_session_screen.dart` | 从线程快照往下传 |
| Modify `apps/mobile/lib/features/threads/thread_info_sheets.dart` | sheet 去掉被藏的 tab |

---

### Task 1: Runtime 对照表

**Files:**
- Create: `packages/runtime/src/acp-host-ui-features.ts`
- Create: `packages/runtime/test/acp-host-ui-features.test.ts`
- Modify: `packages/runtime/src/index.ts`（在 `export * from "./acp-event-map.js"` 旁增加 `export * from "./acp-host-ui-features.js"`）

**Interfaces:**
- Consumes: `AcpAgentId` from `packages/runtime/src/core-runtime.ts`
- Produces:

```ts
export const ACP_HOST_UI_FEATURES = ["contextUsage", "billing"] as const;
export type AcpHostUiFeature = (typeof ACP_HOST_UI_FEATURES)[number];
export type AcpHostUiVisibility = "show" | "hide";
export type AcpHostUiFeatures = Record<AcpHostUiFeature, AcpHostUiVisibility>;

export const DEFAULT_ACP_HOST_UI_FEATURES: AcpHostUiFeatures;
export const ACP_HOST_UI_FEATURE_TABLE: Record<AcpAgentId, AcpHostUiFeatures>;

export function resolveAcpHostUiFeatures(input: {
  coreKind?: string;
  acpAgentId?: string;
}): AcpHostUiFeatures;

export function normalizeAcpHostUiFeatures(raw: unknown): AcpHostUiFeatures;

export function isAcpHostUiFeatureVisible(
  features: AcpHostUiFeatures | undefined,
  feature: AcpHostUiFeature,
): boolean;
```

- [ ] **Step 1: Write the failing test**

Create `packages/runtime/test/acp-host-ui-features.test.ts`:

```ts
import { expect, test } from "bun:test";
import {
  DEFAULT_ACP_HOST_UI_FEATURES,
  isAcpHostUiFeatureVisible,
  normalizeAcpHostUiFeatures,
  resolveAcpHostUiFeatures,
} from "../src/acp-host-ui-features.js";

test("cursor hides context usage and billing", () => {
  expect(resolveAcpHostUiFeatures({ coreKind: "acp", acpAgentId: "cursor" })).toEqual({
    contextUsage: "hide",
    billing: "hide",
  });
});

test("non-acp cores show both columns", () => {
  for (const coreKind of ["claude", "codex", "pi"] as const) {
    expect(resolveAcpHostUiFeatures({ coreKind })).toEqual(DEFAULT_ACP_HOST_UI_FEATURES);
  }
});

test("unknown or missing acp agent defaults to show", () => {
  expect(resolveAcpHostUiFeatures({ coreKind: "acp" })).toEqual(DEFAULT_ACP_HOST_UI_FEATURES);
  expect(resolveAcpHostUiFeatures({ coreKind: "acp", acpAgentId: "other" })).toEqual(
    DEFAULT_ACP_HOST_UI_FEATURES,
  );
  expect(resolveAcpHostUiFeatures({ coreKind: "acp", acpAgentId: "  " })).toEqual(
    DEFAULT_ACP_HOST_UI_FEATURES,
  );
});

test("normalize missing object is all show", () => {
  expect(normalizeAcpHostUiFeatures(undefined)).toEqual(DEFAULT_ACP_HOST_UI_FEATURES);
  expect(normalizeAcpHostUiFeatures(null)).toEqual(DEFAULT_ACP_HOST_UI_FEATURES);
});

test("normalize dirty column falls back to show and keeps a valid hide", () => {
  expect(
    normalizeAcpHostUiFeatures({ contextUsage: "hide", billing: "nope" }),
  ).toEqual({ contextUsage: "hide", billing: "show" });
  expect(normalizeAcpHostUiFeatures({ contextUsage: "hide" })).toEqual({
    contextUsage: "hide",
    billing: "show",
  });
});

test("isAcpHostUiFeatureVisible treats missing features as show", () => {
  expect(isAcpHostUiFeatureVisible(undefined, "billing")).toBe(true);
  expect(
    isAcpHostUiFeatureVisible({ contextUsage: "hide", billing: "hide" }, "billing"),
  ).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/runtime/test/acp-host-ui-features.test.ts`

Expected: FAIL resolving `../src/acp-host-ui-features.js` (module not found).

- [ ] **Step 3: Write minimal implementation**

Create `packages/runtime/src/acp-host-ui-features.ts`:

```ts
import type { AcpAgentId } from "./core-runtime.js";

export const ACP_HOST_UI_FEATURES = ["contextUsage", "billing"] as const;
export type AcpHostUiFeature = (typeof ACP_HOST_UI_FEATURES)[number];
export type AcpHostUiVisibility = "show" | "hide";
export type AcpHostUiFeatures = Record<AcpHostUiFeature, AcpHostUiVisibility>;

export const DEFAULT_ACP_HOST_UI_FEATURES: AcpHostUiFeatures = {
  contextUsage: "show",
  billing: "show",
};

export const ACP_HOST_UI_FEATURE_TABLE: Record<AcpAgentId, AcpHostUiFeatures> = {
  cursor: { contextUsage: "hide", billing: "hide" },
};

export function resolveAcpHostUiFeatures(input: {
  coreKind?: string;
  acpAgentId?: string;
}): AcpHostUiFeatures {
  if (input.coreKind !== "acp") {
    return { ...DEFAULT_ACP_HOST_UI_FEATURES };
  }
  const id = input.acpAgentId?.trim() ?? "";
  if (id && Object.hasOwn(ACP_HOST_UI_FEATURE_TABLE, id)) {
    return { ...ACP_HOST_UI_FEATURE_TABLE[id as AcpAgentId] };
  }
  return { ...DEFAULT_ACP_HOST_UI_FEATURES };
}

export function normalizeAcpHostUiFeatures(raw: unknown): AcpHostUiFeatures {
  const record = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  return {
    contextUsage: record.contextUsage === "hide" ? "hide" : "show",
    billing: record.billing === "hide" ? "hide" : "show",
  };
}

export function isAcpHostUiFeatureVisible(
  features: AcpHostUiFeatures | undefined,
  feature: AcpHostUiFeature,
): boolean {
  return normalizeAcpHostUiFeatures(features)[feature] === "show";
}
```

In `packages/runtime/src/index.ts`, next to the other `acp-*` exports, add:

```ts
export * from "./acp-host-ui-features.js";
```

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `bun test packages/runtime/test/acp-host-ui-features.test.ts`

Expected: PASS (6 tests).

- [ ] **Step 5: Commit**（仅当用户要求）

```bash
git add packages/runtime/src/acp-host-ui-features.ts packages/runtime/test/acp-host-ui-features.test.ts packages/runtime/src/index.ts
git commit -m "$(cat <<'EOF'
feat: add ACP host UI feature table for context and billing

EOF
)"
```

---

### Task 2: `ThreadSummary.hostUiFeatures` 下发

**Files:**
- Modify: `apps/desktop/src/shared/ipc.ts`（`ThreadSummary` 接口，约 1260–1281 行）
- Modify: `apps/desktop/src/main/conversation-store.ts`（`rowToThread`，约 5864–5888 行；文件顶部 `@eco/runtime` import）
- Modify: `apps/desktop/src/main/index.ts`（建线程对象，约 4983–4996 行；确认已能 import `resolveAcpHostUiFeatures`）
- Modify: `apps/desktop/src/main/remote-thread-list.ts`
- Modify: `apps/desktop/test/conversation-store-runtime.test.ts`
- Modify: `apps/desktop/test/remote-traffic-transform.test.ts`

**Interfaces:**
- Consumes: `resolveAcpHostUiFeatures` from Task 1
- Produces: `ThreadSummary.hostUiFeatures?: AcpHostUiFeatures` 在读库、建线程、remote list 三条路径上始终被赋值

- [ ] **Step 1: Write the failing tests**

Append to `apps/desktop/test/conversation-store-runtime.test.ts`:

```ts
test.skipIf(!sqliteAvailable)("derives hostUiFeatures for acp cursor and claude threads", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "eco-host-ui-features-"));
  const store = await createConversationStore(path.join(dir, "eco-coding.sqlite"));
  const now = new Date().toISOString();
  store.saveThread({
    id: "thr_cursor",
    title: "Cursor",
    prompt: "hi",
    workspacePath: "/tmp/project",
    status: "idle",
    message: "",
    createdAt: now,
    updatedAt: now,
    coreKind: "acp",
    acpAgentId: "cursor",
  });
  store.saveThread({
    id: "thr_claude",
    title: "Claude",
    prompt: "hi",
    workspacePath: "/tmp/project",
    status: "idle",
    message: "",
    createdAt: now,
    updatedAt: now,
    coreKind: "claude",
  });
  expect(store.getThread("thr_cursor")?.hostUiFeatures).toEqual({
    contextUsage: "hide",
    billing: "hide",
  });
  expect(store.getThread("thr_claude")?.hostUiFeatures).toEqual({
    contextUsage: "show",
    billing: "show",
  });
});
```

In `apps/desktop/test/remote-traffic-transform.test.ts`, after the existing summarized-thread assertions, add:

```ts
test("remote thread list keeps hostUiFeatures", () => {
  const summarized = summarizeThreadForRemoteList({
    ...thread,
    coreKind: "acp",
    acpAgentId: "cursor",
    hostUiFeatures: { contextUsage: "hide", billing: "hide" },
  });
  expect(summarized.hostUiFeatures).toEqual({ contextUsage: "hide", billing: "hide" });
  expect(summarized.runtimeConfig).toBeUndefined();
});
```

`thread` 已在该文件顶部定义；补上 `hostUiFeatures` 字段即可。若现有 `thread` 字面量没有该字段，不要改它的类型断言，新测试传入展开后的对象。

- [ ] **Step 2: Run tests to verify they fail**

Run:

```
bun test apps/desktop/test/conversation-store-runtime.test.ts apps/desktop/test/remote-traffic-transform.test.ts
```

Expected: conversation-store 新断言 FAIL（`hostUiFeatures` undefined）；remote list FAIL（字段被丢掉）。

- [ ] **Step 3: Write minimal implementation**

In `apps/desktop/src/shared/ipc.ts` `ThreadSummary` 增加：

```ts
  /** Derived ACP host UI visibility; never persisted. */
  hostUiFeatures?: import("@eco/runtime").AcpHostUiFeatures;
```

`apps/desktop/src/main/conversation-store.ts` 顶部 import 从：

```ts
import {
  type CoreKind,
  createToolOutputPreview,
  isCoreKind,
  isFreshSubagentRequest,
  mergeStreamText,
} from "@eco/runtime";
```

改为同时导入 `resolveAcpHostUiFeatures`。

`rowToThread` 在拼好 `coreKind` / `acpAgentId` 之后写入（不要入库）：

```ts
function rowToThread(row: ThreadRow): ThreadSummary {
  const runtimeConfig = parseThreadRuntimeConfigJson(row.runtime_config_json);
  const upgraded = upgradeLegacyCursorCore({
    coreKind: row.core_kind,
    acpAgentId: row.acp_agent_id,
  });
  const coreKind = upgraded.coreKind;
  const acpAgentId =
    coreKind === "acp"
      ? upgraded.acpAgentId ?? resolveAcpThreadAgentId({ acpAgentId: row.acp_agent_id ?? undefined })
      : undefined;
  return {
    id: row.id,
    title: row.title,
    prompt: row.prompt,
    workspacePath: row.workspace_path,
    status: row.status as ThreadStatus,
    message: row.message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(coreKind ? { coreKind } : {}),
    ...(acpAgentId ? { acpAgentId } : {}),
    hostUiFeatures: resolveAcpHostUiFeatures({
      ...(coreKind ? { coreKind } : {}),
      ...(acpAgentId ? { acpAgentId } : {}),
    }),
    ...(row.core_locked_at ? { coreLockedAt: row.core_locked_at } : {}),
    ...(row.sdk_session_id && row.sdk_cwd ? { sdkSessionId: row.sdk_session_id, sdkCwd: row.sdk_cwd } : {}),
    ...(runtimeConfig ? { runtimeConfig } : {}),
  };
}
```

`apps/desktop/src/main/index.ts` 建线程对象（约 4983 行）增加：

```ts
    const acpAgentId = coreKind === "acp" ? ("cursor" as const) : undefined;
    const thread: ThreadSummary = {
      id: `thr_${Date.now()}`,
      title: resolvePendingThreadTitle(currentAppLocale()),
      prompt,
      workspacePath: workspace.path,
      status,
      createdAt: now,
      updatedAt: now,
      coreKind,
      ...(acpAgentId ? { acpAgentId } : {}),
      hostUiFeatures: resolveAcpHostUiFeatures({
        coreKind,
        ...(acpAgentId ? { acpAgentId } : {}),
      }),
      coreLockedAt: now,
      message: resolvedRuntimeConfig.ok ? "" : resolvedRuntimeConfig.reason,
      runtimeConfig: threadRuntime,
    };
```

该文件若尚未 import `resolveAcpHostUiFeatures`，从 `@eco/runtime` 加上。

`apps/desktop/src/main/remote-thread-list.ts`：

```ts
  return {
    id: thread.id,
    title: thread.title ?? "",
    prompt: truncateField(prompt, REMOTE_THREAD_LIST_PROMPT_MAX_CHARS),
    workspacePath: thread.workspacePath ?? "",
    status: thread.status,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    message: truncateField(message, REMOTE_THREAD_LIST_MESSAGE_MAX_CHARS),
    ...(thread.coreKind ? { coreKind: thread.coreKind } : {}),
    ...(thread.acpAgentId ? { acpAgentId: thread.acpAgentId } : {}),
    ...(thread.hostUiFeatures ? { hostUiFeatures: thread.hostUiFeatures } : {}),
    ...(thread.coreLockedAt ? { coreLockedAt: thread.coreLockedAt } : {}),
  };
```

- [ ] **Step 4: Run the tests and make sure they pass**

Run:

```
bun test apps/desktop/test/conversation-store-runtime.test.ts apps/desktop/test/remote-traffic-transform.test.ts
```

Expected: PASS。

- [ ] **Step 5: Commit**（仅当用户要求）

```bash
git add apps/desktop/src/shared/ipc.ts apps/desktop/src/main/conversation-store.ts apps/desktop/src/main/index.ts apps/desktop/src/main/remote-thread-list.ts apps/desktop/test/conversation-store-runtime.test.ts apps/desktop/test/remote-traffic-transform.test.ts
git commit -m "$(cat <<'EOF'
feat: attach derived ACP host UI features on thread summaries

EOF
)"
```

---

### Task 3: 用量 summary 不为 hide 列造占位

**Files:**
- Modify: `apps/desktop/src/shared/thread-usage-summary.ts`
- Modify: `apps/desktop/test/thread-usage-summary.test.ts`

**Interfaces:**
- Consumes: `AcpHostUiFeatures`, `isAcpHostUiFeatureVisible`, `normalizeAcpHostUiFeatures` from Task 1
- Produces:

```ts
export function shouldShowContextUsagePanel(
  status: ThreadStatus | undefined,
  features?: AcpHostUiFeatures,
): boolean;

export function shouldShowBillingUsagePanel(
  status: ThreadStatus | undefined,
  features?: AcpHostUiFeatures,
): boolean;

export function buildThreadUsageSummary(input: ThreadUsageSummaryInput): ThreadUsageSummaryOutput;
```

`ThreadUsageSummaryInput` 增加可选 `hostUiFeatures?: AcpHostUiFeatures`。`contextUsage: hide` 时 output 不含 `context`；`billing: hide` 时 output 不含 `billing`。现有无 `hostUiFeatures` 的调用行为不变（normalize → 全 show）。

- [ ] **Step 1: Write the failing tests**

Append to `apps/desktop/test/thread-usage-summary.test.ts`:

```ts
test("shouldShowContextUsagePanel and billing panel honor hostUiFeatures", () => {
  expect(shouldShowContextUsagePanel("running")).toBe(true);
  expect(
    shouldShowContextUsagePanel("running", { contextUsage: "hide", billing: "show" }),
  ).toBe(false);
  expect(
    shouldShowBillingUsagePanel("running", { contextUsage: "show", billing: "hide" }),
  ).toBe(false);
  expect(
    shouldShowBillingUsagePanel("running", { contextUsage: "hide", billing: "hide" }),
  ).toBe(false);
});

test("buildThreadUsageSummary omits hidden context and billing instead of fabricating them", () => {
  const summary = buildThreadUsageSummary({
    hostUiFeatures: { contextUsage: "hide", billing: "hide" },
    billing: {
      plannerTokenCostUsd: 1,
      ecoCostUsd: 1,
      savedUsd: 0,
      savedPct: 0,
      pricingResolved: true,
      sourceReportedCostUsd: 1,
      totalTokens: { input: 10, output: 10, cacheRead: 0, cacheCreation: 0 },
    } as ThreadBillingSnapshot,
    usageByRole: {
      planner: {
        inputTokens: 10,
        outputTokens: 5,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        contextTokens: 12_000,
        contextLimit: 200_000,
        occupancyPct: 6,
      },
    },
  });
  expect(summary.context).toBeUndefined();
  expect(summary.billing).toBeUndefined();
});
```

在文件顶部增加：

```ts
import type { ThreadBillingSnapshot } from "../src/shared/ipc";
```

并从 `thread-usage-summary` 增加 `shouldShowContextUsagePanel`、`shouldShowBillingUsagePanel`。billing 字面量用 `as ThreadBillingSnapshot`（测试只需要 `totalTokens` 与费用字段）。

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test apps/desktop/test/thread-usage-summary.test.ts`

Expected: FAIL（新导出不存在；现有 summary 仍含 context/billing）。

- [ ] **Step 3: Write minimal implementation**

`apps/desktop/src/shared/thread-usage-summary.ts`：

1. Import：

```ts
import {
  isAcpHostUiFeatureVisible,
  type AcpHostUiFeatures,
} from "@eco/runtime";
```

2. `ThreadUsageSummaryInput` 增加 `hostUiFeatures?: AcpHostUiFeatures`。

3. 在 `shouldShowThreadUsagePanels` 旁增加：

```ts
export function shouldShowContextUsagePanel(
  status: ThreadStatus | undefined,
  features?: AcpHostUiFeatures,
): boolean {
  return shouldShowThreadUsagePanels(status) && isAcpHostUiFeatureVisible(features, "contextUsage");
}

export function shouldShowBillingUsagePanel(
  status: ThreadStatus | undefined,
  features?: AcpHostUiFeatures,
): boolean {
  return shouldShowThreadUsagePanels(status) && isAcpHostUiFeatureVisible(features, "billing");
}
```

4. 改 `buildThreadUsageSummary`：

```ts
export function buildThreadUsageSummary(input: ThreadUsageSummaryInput): ThreadUsageSummaryOutput {
  const showContext = isAcpHostUiFeatureVisible(input.hostUiFeatures, "contextUsage");
  const showBilling = isAcpHostUiFeatureVisible(input.hostUiFeatures, "billing");
  const contextTokens = input.usageByRole ? pickDisplayContextTokens(input.usageByRole) : 0;
  const plannerUsage = input.usageByRole?.planner;
  const context = showContext
    ? buildFallbackContextSnapshot({
        ...(input.context && { context: input.context }),
        ...(contextTokens > 0 && { contextTokens }),
        ...(plannerUsage && { plannerUsage }),
        ...(input.usageByRole && { usageByRole: input.usageByRole }),
      })
    : undefined;

  return {
    ...(showBilling && input.billing ? { billing: input.billing } : {}),
    ...(context && { context }),
    ...(showContext && contextTokens > 0 && { contextTokens }),
  };
}
```

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `bun test apps/desktop/test/thread-usage-summary.test.ts`

Expected: PASS（含原有 fallback 测试）。

- [ ] **Step 5: Commit**（仅当用户要求）

```bash
git add apps/desktop/src/shared/thread-usage-summary.ts apps/desktop/test/thread-usage-summary.test.ts
git commit -m "$(cat <<'EOF'
fix: skip fabricated usage snapshots when ACP host UI hides them

EOF
)"
```

---

### Task 4: 桌面 Composer 与会话信息浮层

**Files:**
- Modify: `apps/desktop/src/renderer/ComposerThreadUsagePills.tsx`
- Modify: `apps/desktop/src/renderer/ThreadInfoPanel.tsx`（`ThreadInfoFloatStack` 约 677–809 行；`ThreadInfoPanel` 里对它的调用约 932–948 行）
- Modify: `apps/desktop/src/renderer/App.tsx`（`threadUsageSummary` 的 `useMemo` 约 4645–4656 行；`<ComposerThreadUsagePills` 约 8508–8519 行）
- Create: `apps/desktop/test/composer-thread-usage-pills.test.tsx`

**Interfaces:**
- Consumes: `shouldShowContextUsagePanel` / `shouldShowBillingUsagePanel` from Task 3；`AcpHostUiFeatures` from Task 1
- Produces: `ComposerThreadUsagePills` 与 `ThreadInfoFloatStack` 增加可选 `hostUiFeatures?: AcpHostUiFeatures`。`showContextFloat` 不再恒为 `true`。

- [ ] **Step 1: Write the failing test**

Create `apps/desktop/test/composer-thread-usage-pills.test.tsx`：

```tsx
import { expect, test } from "bun:test";
import { createElement } from "react";
import { ComposerThreadUsagePills } from "../src/renderer/ComposerThreadUsagePills";
import { renderLocalized } from "./i18n-test";

const usageSummary = {
  billing: {
    plannerTokenCostUsd: 1,
    ecoCostUsd: 1,
    savedUsd: 0,
    savedPct: 0,
    pricingResolved: true,
    sourceReportedCostUsd: 1,
    totalTokens: { input: 10, output: 4, cacheRead: 0, cacheCreation: 0 },
  },
  context: {
    occupied: 12_000,
    limit: 200_000,
    occupancyPct: 6,
    limitsResolved: true,
    segments: [],
    updatedAt: Date.now(),
  },
};

test("hides composer usage pills when ACP host UI features are hide", () => {
  const markup = renderLocalized(
    createElement(ComposerThreadUsagePills, {
      threadId: "thr_cursor",
      threadStatus: "running",
      usageSummary,
      hostUiFeatures: { contextUsage: "hide", billing: "hide" },
    }),
    "zh-CN",
  );
  expect(markup).not.toContain("thread-info-float-stack");
  expect(markup).not.toContain("composer-usage-pills");
});

test("keeps composer usage pills for default show features", () => {
  const markup = renderLocalized(
    createElement(ComposerThreadUsagePills, {
      threadId: "thr_claude",
      threadStatus: "running",
      usageSummary,
    }),
    "zh-CN",
  );
  expect(markup).toContain("thread-info-float-stack");
  expect(markup).toContain("composer-usage-pills");
});
```

`usageSummary.billing` 用 `as import("../src/shared/ipc").ThreadBillingSnapshot`。`ComposerThreadUsagePills` 在本 step 还没有 `hostUiFeatures` prop，测试应因未知 prop 或 hide 时仍渲染 pill 而失败。

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test apps/desktop/test/composer-thread-usage-pills.test.tsx`

Expected: FAIL（未知 prop，或 hide 时 markup 仍含 `thread-info-float-stack`）。

- [ ] **Step 3: Write minimal implementation**

`ComposerThreadUsagePills.tsx`：

- props 增加 `hostUiFeatures?: AcpHostUiFeatures`（从 `@eco/runtime` import type）。
- 用 Task 3 helper 替换 `shouldShowThreadUsagePanels` 决定两列：

```ts
  const showContext = shouldShowContextUsagePanel(threadStatus, hostUiFeatures);
  const showBilling = hasBillingData(billing);
  const showBillingSection =
    shouldShowBillingUsagePanel(threadStatus, hostUiFeatures) &&
    (showBilling || threadStatus !== undefined);

  if (!showBillingSection && !showContext) {
    return null;
  }
```

- 把 `hostUiFeatures` 传给 `ThreadInfoFloatStack`。不再在无 context 时仍画上下文占位：由 float stack 的 `showContext` 控制。

`ThreadInfoFloatStack` 增加：

```ts
  hostUiFeatures?: AcpHostUiFeatures;
  showContext?: boolean;
```

把

```ts
  const showContextFloat = true;
```

改为：

```ts
  const showContextFloat = showContext ?? shouldShowContextUsagePanel(threadStatus, hostUiFeatures);
  const showBillingFloat =
    showBillingSection && shouldShowBillingUsagePanel(threadStatus, hostUiFeatures);
```

`ComposerThreadUsagePills` 调用处传 `showContext={showContext}`。

`ThreadInfoPanel` 内部调用 `ThreadInfoFloatStack` 时传入 `hostUiFeatures`（props 同样增加该可选字段）。今日若没有外部调用者，仍要改这一处，避免以后浮层绕过 Composer。

`App.tsx`：

1. `buildThreadUsageSummary({ ..., hostUiFeatures: activeThread.hostUiFeatures })`
2. `<ComposerThreadUsagePills ... hostUiFeatures={activeThread.hostUiFeatures} />`

- [ ] **Step 4: Run the tests and make sure they pass**

Run:

```
bun test apps/desktop/test/composer-thread-usage-pills.test.tsx apps/desktop/test/thread-usage-summary.test.ts
```

Expected: PASS。

- [ ] **Step 5: Commit**（仅当用户要求）

```bash
git add apps/desktop/src/renderer/ComposerThreadUsagePills.tsx apps/desktop/src/renderer/ThreadInfoPanel.tsx apps/desktop/src/renderer/App.tsx apps/desktop/test/composer-thread-usage-pills.test.tsx
git commit -m "$(cat <<'EOF'
fix: hide Composer context and billing pills from ACP host UI features

EOF
)"
```

---

### Task 5: 移动端环与 sheet

**Files:**
- Create: `apps/mobile/lib/core/models/acp_host_ui_features.dart`
- Create: `apps/mobile/test/acp_host_ui_features_test.dart`
- Modify: `apps/mobile/lib/core/models/thread_models.dart`（`ThreadSummary` / `fromJson` / `copyWith` / `mergeThreadSummaryFromRemoteList`）
- Modify: `apps/mobile/lib/features/composer/composer_controls.dart`（`ComposerRouteSummary`）
- Modify: `apps/mobile/lib/features/composer/session_composer.dart`
- Modify: `apps/mobile/lib/features/threads/thread_session_screen.dart`
- Modify: `apps/mobile/lib/features/threads/thread_info_sheets.dart`
- Modify: `apps/mobile/test/composer_usage_controls_test.dart`

**Interfaces:**
- Consumes: 下发后的 `{ contextUsage, billing }` JSON。**禁止**在 Dart 里复制 Cursor 对照表。
- Produces:

```dart
class AcpHostUiFeatures {
  const AcpHostUiFeatures({this.contextUsage = 'show', this.billing = 'show'});
  final String contextUsage;
  final String billing;
  bool get showContextUsage => contextUsage == 'show';
  bool get showBilling => billing == 'show';
  static const showAll = AcpHostUiFeatures();
  factory AcpHostUiFeatures.fromJson(Object? json);
}
```

`ThreadSummary.hostUiFeatures` 类型为 `AcpHostUiFeatures`，`fromJson` 用 `AcpHostUiFeatures.fromJson`。缺字段 → `showAll`。`mergeThreadSummaryFromRemoteList`：`hostUiFeatures: listed.hostUiFeatures`（list 已带该字段，见 Task 2）。

- [ ] **Step 1: Write the failing tests**

Create `apps/mobile/test/acp_host_ui_features_test.dart`:

```dart
import 'package:eco_mobile/core/models/acp_host_ui_features.dart';
import 'package:eco_mobile/core/models/thread_models.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('fromJson missing object is all show', () {
    expect(AcpHostUiFeatures.fromJson(null).showContextUsage, isTrue);
    expect(AcpHostUiFeatures.fromJson(null).showBilling, isTrue);
  });

  test('fromJson keeps valid hide and falls dirty columns back to show', () {
    final features = AcpHostUiFeatures.fromJson({
      'contextUsage': 'hide',
      'billing': 'nope',
    });
    expect(features.showContextUsage, isFalse);
    expect(features.showBilling, isTrue);
  });

  test('ThreadSummary.fromJson reads hostUiFeatures', () {
    final thread = ThreadSummary.fromJson({
      'id': 'thr_1',
      'title': 't',
      'prompt': 'p',
      'workspacePath': '/tmp',
      'status': 'idle',
      'createdAt': '',
      'updatedAt': '',
      'message': '',
      'coreKind': 'acp',
      'hostUiFeatures': {'contextUsage': 'hide', 'billing': 'hide'},
    });
    expect(thread.hostUiFeatures.showContextUsage, isFalse);
    expect(thread.hostUiFeatures.showBilling, isFalse);
  });
}
```

In `apps/mobile/test/composer_usage_controls_test.dart` 增加（与现有 `_TestApp` + `ComposerRouteSummary` 用法一致，复用文件里已有的 `runtimeConfig` / `billing` / context snapshot）：

```dart
  testWidgets('composer hides context ring when host UI features hide both columns', (
    tester,
  ) async {
    await tester.pumpWidget(
      _TestApp(
        child: ComposerRouteSummary(
          runtimeConfig: runtimeConfig,
          threadId: 'thread-1',
          canEdit: true,
          onChanged: (_) {},
          billing: billing,
          contextSnapshot: const ThreadContextSnapshot(
            occupied: 20,
            limit: 100,
            occupancyPct: 20,
            limitsResolved: true,
          ),
          hostUiFeatures: const AcpHostUiFeatures(
            contextUsage: 'hide',
            billing: 'hide',
          ),
        ),
      ),
    );
    await tester.pump();
    expect(find.byType(ComposerContextRing), findsNothing);
  });
```

文件顶部 import `acp_host_ui_features.dart`。

- [ ] **Step 2: Run tests to verify they fail**

Run:

```
cd apps/mobile && flutter test test/acp_host_ui_features_test.dart test/composer_usage_controls_test.dart
```

Expected: FAIL（`acp_host_ui_features.dart` 不存在；`ComposerRouteSummary` 无 `hostUiFeatures`；有 snapshot 时环仍在）。

- [ ] **Step 3: Write minimal implementation**

Create `apps/mobile/lib/core/models/acp_host_ui_features.dart`:

```dart
class AcpHostUiFeatures {
  const AcpHostUiFeatures({this.contextUsage = 'show', this.billing = 'show'});

  static const showAll = AcpHostUiFeatures();

  final String contextUsage;
  final String billing;

  bool get showContextUsage => contextUsage == 'show';
  bool get showBilling => billing == 'show';

  factory AcpHostUiFeatures.fromJson(Object? json) {
    if (json is! Map) {
      return showAll;
    }
    final map = Map<String, dynamic>.from(json);
    return AcpHostUiFeatures(
      contextUsage: map['contextUsage'] == 'hide' ? 'hide' : 'show',
      billing: map['billing'] == 'hide' ? 'hide' : 'show',
    );
  }
}
```

`ThreadSummary`：增加 `this.hostUiFeatures = AcpHostUiFeatures.showAll`；`fromJson` 设 `hostUiFeatures: AcpHostUiFeatures.fromJson(json['hostUiFeatures'])`；`copyWith` / `mergeThreadSummaryFromRemoteList` 带上 `hostUiFeatures: listed.hostUiFeatures`（copyWith 用参数或保留 this）。

`ComposerRouteSummary` 增加 `this.hostUiFeatures = AcpHostUiFeatures.showAll`。`build` 里：

```dart
    final features = hostUiFeatures;
    final occupancyPct = features.showContextUsage
        ? resolvePlannerOccupancyPct(contextSnapshot)
        : null;
    final showRing =
        (features.showContextUsage || features.showBilling) &&
        (features.showContextUsage ? contextSnapshot != null : billing != null);
```

`showRing` 为 false 时不建 `ComposerToolbarIconButton` / `ComposerContextRing`。

点开 sheet 时传入：

```dart
            onPressed: () => showThreadContextSheet(
              context: context,
              contextSnapshot: features.showContextUsage ? contextSnapshot : null,
              billing: features.showBilling ? billing : null,
              showContextUsage: features.showContextUsage,
              showBilling: features.showBilling,
              ...
            ),
```

tooltip：无 occupancy 时不要拼 `xx%`；`!showBilling` 时不要拼费用。

`showThreadContextSheet` / `_ContextBillingTabs` 增加 `showContextUsage` / `showBilling`（默认 `true`，以免其它调用崩）。`PageView.children` 只放入仍显示的页；对应 title tab 同样省略。两列都 false 时 Composer 根本不会调用 sheet。

`SessionComposer` 增加 `hostUiFeatures`，传给 `ComposerRouteSummary`。

`thread_session_screen.dart` 里构造 `SessionComposer` 处传 `hostUiFeatures: thread?.hostUiFeatures ?? AcpHostUiFeatures.showAll`。

- [ ] **Step 4: Run the tests and make sure they pass**

Run:

```
cd apps/mobile && flutter test test/acp_host_ui_features_test.dart test/composer_usage_controls_test.dart
```

Expected: PASS（含原有「有 snapshot 就显示环」的测试：未传 `hostUiFeatures` 时默认 show）。

- [ ] **Step 5: Commit**（仅当用户要求）

```bash
git add apps/mobile/lib/core/models/acp_host_ui_features.dart apps/mobile/test/acp_host_ui_features_test.dart apps/mobile/lib/core/models/thread_models.dart apps/mobile/lib/features/composer/composer_controls.dart apps/mobile/lib/features/composer/session_composer.dart apps/mobile/lib/features/threads/thread_session_screen.dart apps/mobile/lib/features/threads/thread_info_sheets.dart apps/mobile/test/composer_usage_controls_test.dart
git commit -m "$(cat <<'EOF'
fix: hide mobile context ring using ACP host UI features

EOF
)"
```

---

## Spec coverage

| Spec 要求 | Task |
|---|---|
| 对照表 + resolve / normalize / isVisible | 1 |
| Cursor hide；非 acp / 未知 agent show | 1 |
| `ThreadSummary.hostUiFeatures` 现算、不入库 | 2 |
| remote list 带 features，避免 merge 成全 show | 2 |
| hide 不造 fallback 快照 | 3 |
| 桌面 Composer + `ThreadInfoFloatStack` | 4 |
| 移动端环 + sheet | 5 |
| 不映射 `usage_update`；不改 `CoreCapabilities`；不迁 title regen | 全任务都不做 |

## 实现时注意

- `upgradeLegacyCursorCore` 对 `coreKind === "acp"` 会把 agent 写成 `"cursor"`。`rowToThread` 仍应把解析后的 id 交给 `resolveAcpHostUiFeatures`，不要在 UI 里写死 cursor。
- `ThreadInfoFloatStack` 今日 `showContextFloat = true` 是空占位的根因；必须改掉，不能只藏 Composer 包装层。
- 移动端 **不要** 再维护一份 `cursor → hide` 表。
