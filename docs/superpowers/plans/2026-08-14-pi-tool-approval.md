# PI Agent 工具审批 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** PI Agent 在工具执行前走 Eco 工具审批：Claude 式 `tool_call` 入口，落盘到与 Claude/Codex 共用的 `BashApproval` 队列/UI。

**Architecture:** Runtime 新增 `eco-pi-approval` extension，把 PI `tool_call` 映射为 `SdkToolPermissionRequest`，调用注入的 `SdkToolPermissionHandler`，再映射回 `{ block, reason, terminate }`。Desktop 把现有 `createThreadToolPermissionHandler(threadId)` 经 `piSession` 传入；会话热复用时每轮 re-arm（`bashReviewMode` 可在不重建会话时改成 `allow_all`）。子代理 `createDefaultPiSession` 同样注入。Capability 标 `toolApproval: "eco"`。

**Tech Stack:** TypeScript, Bun tests, `@earendil-works/pi-coding-agent` 0.84.1 `tool_call` hook, Eco `SdkToolPermissionHandler` / `bash-approval-bridge`.

**Spec:** [docs/superpowers/specs/2026-08-14-pi-tool-approval-design.md](../specs/2026-08-14-pi-tool-approval-design.md)

## Global Constraints

- 不新建第三套审批 UI；不接 PI `ctx.ui` / `extension_ui_request`。
- 不实现 Plan mode / planApproval（保持 `unsupported`）。
- 不启用 ambient PI extensions（继续 `noExtensions: true`）。
- 策略失败或 handler 抛错：fail-closed block，不得放行。
- MCP 非 browser/image：Claude 现有 handler 不拦的，PI 也不拦；不得假装已覆盖。
- Mobile：本计划不新增 Mobile 专测；文档必须写「未验证缺口」，不得声称全端已支持。
- 用户未明确要求时不要 git commit。
- TDD：每个行为先写失败测试，再写实现。

---

## File map

| File | Responsibility |
|------|----------------|
| Create `packages/runtime/src/pi-tool-approval.ts` | Map PI `tool_call` ↔ Eco permission decision; factory |
| Create `packages/runtime/test/pi-tool-approval.test.ts` | Pure mapping + factory tests (mock `pi.on`) |
| Modify `packages/runtime/src/index.ts` | `PiSessionOptions.toolPermissionHandler` |
| Modify `packages/runtime/src/pi-coding-agent-driver.ts` | Inject/re-arm `eco-pi-approval`; recreate on presence drift |
| Modify `packages/runtime/test/pi-core.test.ts` | Driver passes handler into `createSession` and re-arms on reuse |
| Modify `packages/runtime/src/core-runtime.ts` | `toolApproval: "eco"` |
| Modify `packages/runtime/test/pi-subagent.test.ts` | Assert capability |
| Modify `packages/runtime/src/index.ts` (export) | Re-export `pi-tool-approval.ts` |
| Modify `apps/desktop/src/main/pi-runtime-run.ts` | Pass handler from deps into `driver.run` |
| Modify `apps/desktop/src/main/pi-subagent-host.ts` | Child sessions get the same thread handler + agentId/agentType |
| Modify `apps/desktop/src/main/index.ts` | Wire `getToolPermissionHandler` into PI orchestration deps |
| Create `apps/desktop/test/pi-tool-approval-wire.test.ts` | Assert spawn/run input includes handler (no Electron UI) |
| Docs + i18n listed in Task 4 | Remove “不接工具审批”; mark Eco bridge + Mobile gap |

---

### Task 1: PI `tool_call` ↔ Eco permission mapper

**Files:**
- Create: `packages/runtime/src/pi-tool-approval.ts`
- Test: `packages/runtime/test/pi-tool-approval.test.ts`

**Interfaces:**
- Consumes: `SdkToolPermissionHandler` from `packages/runtime/src/ask-user-question.ts`; `SdkToolPermissionRequest` / `SdkToolPermissionDecision` from `packages/runtime/src/tool-permission-types.ts` (or `claude-agent-sdk.ts` re-export — use the same types Claude uses: `./claude-agent-sdk.js` if that is what `ask-user-question` imports).
- Produces:
  - `createEcoPiToolApprovalExtensionFactory(input: CreateEcoPiToolApprovalInput): (pi: EcoPiToolApprovalExtensionApi) => void`
  - `mapSdkPermissionDecisionToPiToolCallResult(decision: SdkToolPermissionDecision, event: { input: Record<string, unknown> }): PiToolCallEventResult | undefined`
  - `applyPiToolCallPermission(event, ctx, input): Promise<PiToolCallEventResult | undefined>`

```typescript
export interface PiToolCallEventLike {
  type: "tool_call";
  toolCallId: string;
  toolName: string;
  input: Record<string, unknown>;
}

export interface PiToolCallEventResult {
  block?: boolean;
  reason?: string;
  terminate?: boolean;
}

export interface EcoPiToolApprovalExtensionApi {
  on(
    event: "tool_call",
    handler: (
      event: PiToolCallEventLike,
      ctx: { cwd?: string; signal?: AbortSignal },
    ) => Promise<PiToolCallEventResult | void | undefined>,
  ): void;
}

export interface CreateEcoPiToolApprovalInput {
  onToolPermission: SdkToolPermissionHandler;
  cwd?: string;
  agentId?: string;
  agentType?: string;
  fallbackSignal?: AbortSignal;
}

export const PI_TOOL_APPROVAL_EXTENSION_NAME = "eco-pi-approval" as const;
export const PI_TOOL_APPROVAL_HANDLER_MISSING =
  "Eco tool permission handler is not armed for this PI session.";
export const PI_TOOL_APPROVAL_HANDLER_FAILED =
  "Eco tool permission check failed; tool call blocked.";
```

- [ ] **Step 1: Write the failing tests**

Create `packages/runtime/test/pi-tool-approval.test.ts`:

```typescript
import { expect, test } from "bun:test";
import type { SdkToolPermissionDecision, SdkToolPermissionRequest } from "../src/claude-agent-sdk";
import {
  applyPiToolCallPermission,
  createEcoPiToolApprovalExtensionFactory,
  mapSdkPermissionDecisionToPiToolCallResult,
  type PiToolCallEventLike,
} from "../src/pi-tool-approval";

function event(partial: Partial<PiToolCallEventLike> = {}): PiToolCallEventLike {
  return {
    type: "tool_call",
    toolCallId: "call_1",
    toolName: "bash",
    input: { command: "ls" },
    ...partial,
  };
}

test("allow returns undefined and does not block", () => {
  const ev = event();
  const result = mapSdkPermissionDecisionToPiToolCallResult(
    { behavior: "allow", updatedInput: ev.input },
    ev,
  );
  expect(result).toBeUndefined();
});

test("allow with updatedInput mutates event.input in place", () => {
  const ev = event({ input: { command: "ls" } });
  mapSdkPermissionDecisionToPiToolCallResult(
    { behavior: "allow", updatedInput: { command: "ls -la" } },
    ev,
  );
  expect(ev.input.command).toBe("ls -la");
});

test("deny maps to block plus reason without terminate", () => {
  const result = mapSdkPermissionDecisionToPiToolCallResult(
    { behavior: "deny", message: "User rejected this command." },
    event(),
  );
  expect(result).toEqual({ block: true, reason: "User rejected this command." });
});

test("deny with interrupt sets terminate", () => {
  const result = mapSdkPermissionDecisionToPiToolCallResult(
    { behavior: "deny", message: "Thread was not found.", interrupt: true },
    event(),
  );
  expect(result).toEqual({
    block: true,
    reason: "Thread was not found.",
    terminate: true,
  });
});

test("applyPiToolCallPermission fail-closes when handler throws", async () => {
  const result = await applyPiToolCallPermission(event(), {}, {
    onToolPermission: async () => {
      throw new Error("boom");
    },
  });
  expect(result?.block).toBe(true);
  expect(result?.reason).toContain("blocked");
});

test("applyPiToolCallPermission forwards SdkToolPermissionRequest fields", async () => {
  let seen: SdkToolPermissionRequest | undefined;
  const controller = new AbortController();
  await applyPiToolCallPermission(
    event({ toolName: "write", toolCallId: "w1", input: { path: "a.ts" } }),
    { cwd: "/repo", signal: controller.signal },
    {
      onToolPermission: async (request) => {
        seen = request;
        return { behavior: "allow" } satisfies SdkToolPermissionDecision;
      },
      agentId: "agent_child",
      agentType: "coder",
    },
  );
  expect(seen?.toolName).toBe("write");
  expect(seen?.toolUseId).toBe("w1");
  expect(seen?.input).toEqual({ path: "a.ts" });
  expect(seen?.cwd).toBe("/repo");
  expect(seen?.agentId).toBe("agent_child");
  expect(seen?.agentType).toBe("coder");
  expect(seen?.signal).toBe(controller.signal);
});

test("factory registers tool_call and returns handler result", async () => {
  const handlers: Array<(event: PiToolCallEventLike, ctx: { cwd?: string }) => Promise<unknown>> = [];
  const pi = {
    on(_event: "tool_call", handler: (event: PiToolCallEventLike, ctx: { cwd?: string }) => Promise<unknown>) {
      handlers.push(handler);
    },
  };
  createEcoPiToolApprovalExtensionFactory({
    onToolPermission: async () => ({ behavior: "deny", message: "nope" }),
  })(pi);
  expect(handlers).toHaveLength(1);
  const result = await handlers[0]!(event(), { cwd: "/ws" });
  expect(result).toEqual({ block: true, reason: "nope" });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test packages/runtime/test/pi-tool-approval.test.ts`

Expected: FAIL — `Cannot find module '../src/pi-tool-approval'`

- [ ] **Step 3: Write minimal implementation**

Create `packages/runtime/src/pi-tool-approval.ts`:

- `mapSdkPermissionDecisionToPiToolCallResult`: allow → if `updatedInput` present, `Object.assign(event.input, updatedInput)` then `undefined`; deny → `{ block: true, reason: message }` plus `terminate: true` only when `interrupt === true`.
- `applyPiToolCallPermission`: build `SdkToolPermissionRequest` with `toolName`, `input` (same object so later mutation is visible), `toolUseId: event.toolCallId`, `cwd: ctx.cwd ?? input.cwd`, `signal: ctx.signal ?? input.fallbackSignal ?? new AbortController().signal`, optional `agentId`/`agentType`. Await `onToolPermission`. On throw, return `{ block: true, reason: PI_TOOL_APPROVAL_HANDLER_FAILED }`.
- Factory: `pi.on("tool_call", (event, ctx) => applyPiToolCallPermission(event, ctx, input))`.
- Do not import `@earendil-works/pi-coding-agent` in this file (keep tests fast and Eco-typed).

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test packages/runtime/test/pi-tool-approval.test.ts`

Expected: PASS

- [ ] **Step 5: Export from runtime**

In `packages/runtime/src/index.ts`, add `export * from "./pi-tool-approval.js";` next to `export * from "./pi-eco-extensions.js";`.

---

### Task 2: Inject approval into PI session create + driver re-arm

**Files:**
- Modify: `packages/runtime/src/index.ts` (`PiSessionOptions`)
- Modify: `packages/runtime/src/pi-coding-agent-driver.ts`
- Modify: `packages/runtime/test/pi-core.test.ts`

**Interfaces:**
- Consumes: `createEcoPiToolApprovalExtensionFactory`, `PI_TOOL_APPROVAL_EXTENSION_NAME` from Task 1
- Produces:
  - `PiSessionOptions.toolPermissionHandler?: SdkToolPermissionHandler`
  - `PiSessionOptions.toolApprovalAgentId?: string`
  - `PiSessionOptions.toolApprovalAgentType?: string`
  - `PiSessionFactoryInput.toolPermissionHandler?` (same types)
  - `PiSessionHandle.armToolPermission?: (handler: SdkToolPermissionHandler | undefined) => void`
  - `PiSessionHandle.toolApprovalEnabled?: boolean`

- [ ] **Step 1: Write the failing driver test**

In `packages/runtime/test/pi-core.test.ts`, add a test (reuse `makeHandle` pattern from the existing registry test; extend the returned handle with `armToolPermission` / `toolApprovalEnabled` when the mock createSession sets them):

```typescript
test("PiCodingAgentDriver injects eco-pi-approval and re-arms handler on session reuse", async () => {
  const registry = new PiSessionRegistry();
  const captured: Array<{
    names: string[];
    armed?: boolean;
  }> = [];
  let createCount = 0;
  const handlers: SdkToolPermissionHandler[] = [];

  const driver = new PiCodingAgentDriver(
    {
      createSession: async (input) => {
        createCount += 1;
        captured.push({
          names: (input.extensionFactories ?? []).map((e) => e.name),
        });
        const handle = makeHandle(
          `sess_${createCount}`,
          input.cwd,
          input.routeFingerprint,
          "",
          `/tmp/pi_${createCount}.jsonl`,
        );
        handle.toolApprovalEnabled = Boolean(input.toolPermissionHandler);
        handle.armToolPermission = (handler) => {
          handlers.push(handler as SdkToolPermissionHandler);
        };
        return handle;
      },
      resolveBridgeModel: async () => ({
        bridgeBaseUrl: "http://127.0.0.1:18765",
        bridgeModelId: "alias",
        apiKey: "k",
        agentDir: "/tmp/pi-agent",
        apiCompat: "anthropic",
        bindingId: "bind_1",
        providerId: "p1",
      }),
    },
    registry,
  );

  const first = async function* () {} as AsyncGenerator;
  // First run: must create with eco-pi-approval
  const runInput = (bindingId: string, handler: SdkToolPermissionHandler) => ({
    threadId: "thr_perm",
    prompt: "hi",
    workspacePath: "/ws",
    worktreePath: "/ws",
    routes: [{ role: "planner", primary: { providerId: "p1", modelId: "m1" }, fallbacks: [] }],
    signal: new AbortController().signal,
    piSession: { toolPermissionHandler: handler },
  });

  const allow: SdkToolPermissionHandler = async () => ({ behavior: "allow" });
  for await (const _ of driver.run(runInput("bind_1", allow) as never)) {
    void _;
  }
  expect(createCount).toBe(1);
  expect(captured[0]?.names).toContain("eco-pi-approval");

  const deny: SdkToolPermissionHandler = async () => ({
    behavior: "deny",
    message: "no",
  });
  for await (const _ of driver.run({
    ...runInput("bind_1", deny),
    // same identity so session is reused; only binding may change — keep same fingerprint fields
  } as never)) {
    void _;
  }
  expect(createCount).toBe(1);
  expect(handlers.length).toBeGreaterThan(0);
});
```

Adapt `runInput` to match the existing test's `resolveBridgeModel` / route shape exactly (copy from `PiSessionRegistry isolates sessions` in the same file). The assertions that must hold:

1. First `createSession` `extensionFactories` includes `{ name: "eco-pi-approval" }`.
2. Second run with the same cwd/model/MCP does **not** increment `createCount`.
3. `armToolPermission` is invoked on the reused handle with the latest handler.

Also add:

```typescript
test("PiCodingAgentDriver recreates session when tool approval presence drifts", async () => {
  // first run without handler, second run with handler → createCount === 2
});
```

- [ ] **Step 2: Run the new tests — expect FAIL**

Run: `bun test packages/runtime/test/pi-core.test.ts`

Expected: FAIL on `toContain("eco-pi-approval")` (factories do not include it yet).

- [ ] **Step 3: Implement wiring**

`PiSessionOptions` in `packages/runtime/src/index.ts`:

```typescript
  /** Eco tool permission callback (Claude canUseTool shape). */
  toolPermissionHandler?: import("./ask-user-question.js").SdkToolPermissionHandler;
  toolApprovalAgentId?: string;
  toolApprovalAgentType?: string;
```

`PiSessionFactoryInput` in `pi-coding-agent-driver.ts`: add the same three optional fields.

`createDefaultPiSession`: after building `extensionFactories` from MCP + `input.extensionFactories`, if `input.toolPermissionHandler`:

```typescript
extensionFactories.push({
  name: PI_TOOL_APPROVAL_EXTENSION_NAME,
  factory: createEcoPiToolApprovalExtensionFactory({
    onToolPermission: input.toolPermissionHandler,
    cwd: input.cwd,
    ...(input.toolApprovalAgentId ? { agentId: input.toolApprovalAgentId } : {}),
    ...(input.toolApprovalAgentType ? { agentType: input.toolApprovalAgentType } : {}),
  }) as (pi: unknown) => void,
});
```

`PiCodingAgentDriver.run` — mirror `spawnBridge`:

```typescript
const permissionBridge: {
  handler: SdkToolPermissionHandler | undefined;
} = {
  handler: input.piSession?.toolPermissionHandler,
};
const wantsToolApproval = Boolean(permissionBridge.handler);
const approvalDrift =
  Boolean(session) && wantsToolApproval !== Boolean(session!.toolApprovalEnabled);
```

Include `approvalDrift` in `forceFresh` (alongside `identityDrift || mcpDrift || agentToolDrift`).

When creating a session and `wantsToolApproval`:

```typescript
extensionFactories.push({
  name: PI_TOOL_APPROVAL_EXTENSION_NAME,
  factory: createEcoPiToolApprovalExtensionFactory({
    onToolPermission: async (request) => {
      const handler = permissionBridge.handler;
      if (!handler) {
        return {
          behavior: "deny",
          message: PI_TOOL_APPROVAL_HANDLER_MISSING,
          interrupt: true,
        };
      }
      return handler(request);
    },
    cwd,
    ...(input.piSession?.toolApprovalAgentId
      ? { agentId: input.piSession.toolApprovalAgentId }
      : {}),
    ...(input.piSession?.toolApprovalAgentType
      ? { agentType: input.piSession.toolApprovalAgentType }
      : {}),
  }) as (pi: unknown) => void,
});
```

After `createSession`, always:

```typescript
session.toolApprovalEnabled = wantsToolApproval;
session.armToolPermission = (handler) => {
  permissionBridge.handler = handler;
};
```

On the reuse path (existing session, not forceFresh), before `prompt`:

```typescript
session.armToolPermission?.(input.piSession?.toolPermissionHandler);
session.toolApprovalEnabled = wantsToolApproval;
```

`createDefaultPiSession` used by subagents: they pass `toolPermissionHandler` on factory input (Task 3). Driver parent path uses the bridge so reuse stays fail-closed if somehow unarmed.

- [ ] **Step 4: Run tests**

Run: `bun test packages/runtime/test/pi-core.test.ts packages/runtime/test/pi-tool-approval.test.ts`

Expected: PASS

Fix `makeHandle` in existing tests if TypeScript requires the new optional fields (they are optional — should not break).

---

### Task 3: Desktop injects Claude's `createThreadToolPermissionHandler`

**Files:**
- Modify: `apps/desktop/src/main/pi-runtime-run.ts`
- Modify: `apps/desktop/src/main/pi-subagent-host.ts`
- Modify: `apps/desktop/src/main/index.ts`
- Create: `apps/desktop/test/pi-tool-approval-wire.test.ts`

**Interfaces:**
- Consumes: `createThreadToolPermissionHandler(threadId, runPhase?, skipExecutionApprovals?)` already in `apps/desktop/src/main/index.ts` (~12074). Claude already calls it with `bashReviewMode === "allow_all"` as skip.
- Produces: PI parent + child sessions receive that same function, rebuilt each run so `allow_all` is live.

- [ ] **Step 1: Write a failing wire test**

Do **not** boot Electron. Extract a tiny pure helper if `index.ts` cannot be imported from tests.

Add to `pi-runtime-run.ts` (exported for tests):

```typescript
export function resolvePiSkipExecutionApprovals(bashReviewMode: string | undefined): boolean {
  return bashReviewMode === "allow_all";
}

export function buildPiSessionToolApprovalFields(input: {
  toolPermissionHandler?: import("@eco/runtime").SdkToolPermissionHandler;
  agentId?: string;
  agentType?: string;
}): Pick<
  import("@eco/runtime").PiSessionOptions,
  "toolPermissionHandler" | "toolApprovalAgentId" | "toolApprovalAgentType"
> {
  if (!input.toolPermissionHandler) {
    return {};
  }
  return {
    toolPermissionHandler: input.toolPermissionHandler,
    ...(input.agentId ? { toolApprovalAgentId: input.agentId } : {}),
    ...(input.agentType ? { toolApprovalAgentType: input.agentType } : {}),
  };
}
```

Test `apps/desktop/test/pi-tool-approval-wire.test.ts`:

```typescript
import { expect, test } from "bun:test";
import {
  buildPiSessionToolApprovalFields,
  resolvePiSkipExecutionApprovals,
} from "../src/main/pi-runtime-run";

test("allow_all skips Eco execution approvals like Claude", () => {
  expect(resolvePiSkipExecutionApprovals("allow_all")).toBe(true);
  expect(resolvePiSkipExecutionApprovals("always")).toBe(false);
  expect(resolvePiSkipExecutionApprovals("auto")).toBe(false);
});

test("omits approval fields when handler is missing — do not pretend PI is gated", () => {
  expect(buildPiSessionToolApprovalFields({})).toEqual({});
});

test("passes handler and subagent attribution through to piSession", () => {
  const handler = async () => ({ behavior: "allow" as const });
  const fields = buildPiSessionToolApprovalFields({
    toolPermissionHandler: handler,
    agentId: "ag_1",
    agentType: "coder",
  });
  expect(fields.toolPermissionHandler).toBe(handler);
  expect(fields.toolApprovalAgentId).toBe("ag_1");
  expect(fields.toolApprovalAgentType).toBe("coder");
});
```

- [ ] **Step 2: Run test — expect FAIL** until helpers exist.

Run: `bun test apps/desktop/test/pi-tool-approval-wire.test.ts`

- [ ] **Step 3: Wire desktop**

`PiRuntimeOrchestrationDeps` add:

```typescript
  getToolPermissionHandler: (
    threadId: string,
    skipExecutionApprovals: boolean,
  ) => import("@eco/runtime").SdkToolPermissionHandler;
  getBashReviewMode: (threadId: string) => "always" | "auto" | "allow_all";
```

In `startPiThreadRun` (where `driver.run({ piSession: { ... }})` is built):

```typescript
const bashReviewMode = deps.getBashReviewMode(input.thread.id);
const toolPermissionHandler = deps.getToolPermissionHandler(
  input.thread.id,
  resolvePiSkipExecutionApprovals(bashReviewMode),
);
```

Spread `buildPiSessionToolApprovalFields({ toolPermissionHandler })` into `piSession`. Parent does not set `toolApprovalAgentType` (planner fallback inside `resolveBashApprovalAgentId`).

Pass `toolPermissionHandler` into `createPiSubagentSpawnHandler({ ..., toolPermissionHandler })`.

`createPiSubagentSpawnHandler`: add `toolPermissionHandler` to input. When calling `createDefaultPiSession`, spread:

```typescript
...buildPiSessionToolApprovalFields({
  toolPermissionHandler: input.toolPermissionHandler,
  agentId,              // child instance id already created above
  agentType: agent.agentKey,
}),
```

`apps/desktop/src/main/index.ts` `piRuntimeOrchestrationDeps()`:

```typescript
getBashReviewMode: (threadId) => {
  const thread = conversationStore.getThread(threadId);
  return thread
    ? ensureThreadRuntimeConfig(thread).runtimeConfig?.bashReviewMode ?? "always"
    : "always";
},
getToolPermissionHandler: (threadId, skipExecutionApprovals) =>
  createThreadToolPermissionHandler(threadId, "execution", skipExecutionApprovals),
```

Do not duplicate bash/filesystem policy. Image/browser/ask-user stay inside the existing composer.

If `getToolPermissionHandler` is omitted in tests of `pi-runtime-run`, those tests must be updated to provide a stub — **do not silently skip approval** in production `startPiThreadRun`. If deps are missing the function, throw: `"PI tool permission handler is not configured."`

- [ ] **Step 4: Run tests**

Run:

```
bun test apps/desktop/test/pi-tool-approval-wire.test.ts apps/desktop/test/pi-disk-resume.test.ts apps/desktop/test/pi-mcp-session.test.ts packages/runtime/test/pi-core.test.ts packages/runtime/test/pi-tool-approval.test.ts
```

Expected: PASS. If `piRuntimeOrchestrationDeps` test doubles exist, add the two new functions or they will throw — that throw is correct for incomplete doubles.

**Manual check (not claimed done until run):** PI thread, `bashReviewMode=always`, model calls `bash`; same `BashApprovalPanel` as Claude; deny → tool does not run; `bash_approval.*` events appear. `allow_all` → no card. Subagent bash uses the same thread card.

**Mobile gap:** do not add a “supported on Mobile” sentence. USER_GUIDE must say Desktop 审批卡已接 PI；Mobile 对 PI 线程审批 **未验证**.

---

### Task 4: Capability + docs + i18n

**Files:**
- Modify: `packages/runtime/src/core-runtime.ts` (`toolApproval: "eco"`)
- Modify: `packages/runtime/test/pi-subagent.test.ts`
- Modify: `apps/desktop/src/shared/i18n-catalogs.ts` (zh + en PI default-core hint)
- Modify: `docs/USER_GUIDE.md`, `docs/USER_GUIDE.en.md`
- Modify: `docs/TECHNICAL.md`, `docs/TECHNICAL.en.md`
- Modify: `README.md`, `README.en.md`
- Modify: `docs/superpowers/specs/2026-08-14-pi-tool-approval-design.md` status → `accepted`

- [ ] **Step 1: Failing capability test**

In `packages/runtime/test/pi-subagent.test.ts`, extend the existing test:

```typescript
test("PI_CORE_CAPABILITIES marks subagents as eco", () => {
  expect(PI_CORE_CAPABILITIES.subagents).toBe("eco");
  expect(PI_CORE_CAPABILITIES.mcp).toBe("eco");
  expect(PI_CORE_CAPABILITIES.skills).toBe("eco");
  expect(PI_CORE_CAPABILITIES.toolApproval).toBe("eco");
  expect(PI_CORE_CAPABILITIES.planApproval).toBe("unsupported");
});
```

- [ ] **Step 2: Run — expect FAIL** (`unsupported` vs `eco`)

Run: `bun test packages/runtime/test/pi-subagent.test.ts`

- [ ] **Step 3: Flip capability and rewrite copy**

`PI_CORE_CAPABILITIES.toolApproval`: `"eco"`. Leave `planApproval: "unsupported"` and `sessionModes: ["agent"]`.

Replace every “不接工具审批” / “no tool approvals” / “tool approvals remain unsupported” / “不接工具/计划审批” with wording that matches:

- 中文：工具审批由 Eco 桥接（与 Claude 同一套确认卡与 `bashReviewMode`）；计划审批仍不支持。
- English: tool approvals are Eco-bridged (same BashApproval UI and `bashReviewMode` as Claude); plan approval remains unsupported.
- i18n default-core hint: drop “不接工具审批”; say “Eco 桥接工具审批（执行确认档位与 Claude 相同）”.
- TECHNICAL PI 边界：把「不接工具/计划审批」改成「工具审批 capability=`eco`（`tool_call` → `createThreadToolPermissionHandler`）；计划审批仍 unsupported」。
- USER_GUIDE：加一句 **Mobile 对 PI 线程工具审批未验证**，不得写成已支持。

Do not claim MCP-generic tools are gated.

- [ ] **Step 4: Re-run capability test + grep the old phrase**

Run: `bun test packages/runtime/test/pi-subagent.test.ts`

Grep workspace (exclude the spec’s 背景 section if it describes the old state — update 背景 to past tense): `不接工具审批`, `no tool approvals`, `tool approvals remain unsupported`.

Expected: no remaining product copy that says PI has no tool approval, except historical notes in the spec 背景 rewritten as “此前 unsupported”.

---

## Spec coverage

| Spec requirement | Task |
|------------------|------|
| `tool_call` → `SdkToolPermissionHandler` → block/allow | 1 |
| fail-closed on throw | 1 |
| `updatedInput` mutate in place | 1 |
| Driver inject `eco-pi-approval` | 2 |
| Session reuse re-arm (allow_all live) | 2 |
| Recreate when approval presence drifts | 2 |
| Desktop uses `createThreadToolPermissionHandler` | 3 |
| Subagent same thread queue + agentId | 3 |
| `toolApproval: "eco"` | 4 |
| Docs/i18n; no third UI; no plan | 4 |
| Mobile unverified gap explicit | 4 |
| MCP non-browser/image not overclaimed | 4 |

## Placeholder / type check

- Handler type: `SdkToolPermissionHandler` from `ask-user-question.ts` (same as Claude).
- Extension name constant: `eco-pi-approval` / `PI_TOOL_APPROVAL_EXTENSION_NAME`.
- Skip execution approvals: `bashReviewMode === "allow_all"`, same as Claude SDK driver in `index.ts` ~8686–8690.
