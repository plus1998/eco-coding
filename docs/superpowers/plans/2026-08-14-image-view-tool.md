# 默认看图工具 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 三个 runtime 始终注入 Eco MCP `view_image`；工具结果复用现有 ImageView 卡片；用户贴图拦截保持不变。

**Architecture:** 新增始终在线的 `eco_image_view` MCP（对照生图网关，但不进 `INTEGRATION_IDS`）。工具读本地绝对路径、走现有视觉路由做隔离分析，把文本报告当 tool result。Codex / Claude / Pi 的 tool 事件在 `path` 为绝对路径时带上 `metadata.tool.imageView`，Feed 复用 `ImageViewBlock`。贴图拦截继续用 `resolvePromptImagesForMainContext`，视觉 HTTP 抽到共享模块以免复制。

**Tech Stack:** TypeScript, Bun tests, Electron Desktop MCP stdio + control HTTP, existing `readImageViewFile` / runtime proxy / `prompt-image-vision.ts`.

**Spec:** [docs/superpowers/specs/2026-08-14-image-view-tool-design.md](../specs/2026-08-14-image-view-tool-design.md)

## Global Constraints

- 不把看图加入 `INTEGRATION_IDS`，Composer 无开关。
- 不拦截、不关闭 Codex 原生 `view_image` / `imageView` item。
- 不把用户贴图内存附件落盘，不把贴图 Feed 改成 ImageView。
- 不把视觉分析正文铺在 ImageView 卡片上。
- 视觉失败不把原图塞进主 Agent 上下文。
- Agent 主动看图不发 `agent.started` / 子代理 tab；用量仍记 `role: vision`。
- `view_image` 默认 allow，不走 `create_image` 确认卡，不读 `bashReviewMode` 决定是否询问。
- 读盘失败：相对路径不带 `imageView`；绝对路径但文件无效时走现有 ImageViewBlock 错误态（not_found 等），不另做隐藏卡片协议。这是对 spec「无 ImageView」在 Codex/Claude 先发 `tool.started` 下的可实现口径。
- TDD：每个行为先写失败测试再实现。
- 用户未明确要求时不要 git commit。

---

## File map

| File | Responsibility |
|------|----------------|
| Create `packages/runtime/src/eco-image-view-tool.ts` | 工具名常量、识别函数、从 tool args 取绝对 `path` |
| Create `packages/runtime/test/eco-image-view-tool.test.ts` | 上述纯函数测试 |
| Modify `packages/runtime/src/index.ts` | `export * from "./eco-image-view-tool.js"` |
| Modify `packages/runtime/src/codex-event-adapter.ts` | MCP `eco_image_view`/`view_image` 填 `tool.imageView` |
| Modify `packages/runtime/test/codex-event-adapter.test.ts` | MCP 看图事件投影 |
| Modify `apps/desktop/src/main/sdk-stream-activity.ts` | Claude/Pi tool metadata 填 `imageView` |
| Modify `apps/desktop/src/shared/activity-display.ts` | 中文标签「查看图像」 |
| Modify `apps/desktop/src/renderer/activity-log.ts` | icon 归为 image |
| Create `apps/desktop/src/shared/image-view-tool.ts` | prompt append（从 runtime 再导出常量） |
| Modify Desktop/Mobile Feed 测试 | MCP 工具名渲染 ImageView |
| Create `apps/desktop/src/main/vision-analysis.ts` | 抽出视觉 HTTP；贴图拦截与 MCP 共用 |
| Modify `apps/desktop/src/main/index.ts` | 贴图拦截改调抽出函数；注入 MCP；permission allow |
| Create `apps/desktop/src/main/image-view-mcp-gateway.ts` | 始终在线 MCP 网关 |
| Create `apps/desktop/packaging/eco-image-view-mcp-stdio.mjs` | stdio 前端 |
| Modify `apps/desktop/electron-builder.yml` | extraResources 打包 stdio |
| Modify `apps/desktop/src/main/pi-mcp-session.ts` | 始终合并 image-view MCP + prompt |
| Modify `apps/desktop/src/main/codex-approval-bridge.ts` | elicitation 自动 accept |
| Modify wiring 测试 | Claude/Pi/Codex 注入不依赖 `integrationsEnabled` |

---

### Task 1: 工具名与绝对路径 helper

**Files:**
- Create: `packages/runtime/src/eco-image-view-tool.ts`
- Create: `packages/runtime/test/eco-image-view-tool.test.ts`
- Modify: `packages/runtime/src/index.ts`（增加 `export * from "./eco-image-view-tool.js"`）
- Create: `apps/desktop/src/shared/image-view-tool.ts`
- Create: `apps/desktop/test/image-view-tool.test.ts`

**Interfaces:**
- Consumes: Node `path.isAbsolute`
- Produces:

```typescript
export const ECO_IMAGE_VIEW_MCP_SERVER = "eco_image_view" as const;
export const ECO_IMAGE_VIEW_TOOL = "view_image" as const;
export const ECO_IMAGE_VIEW_FULL_TOOL =
  `mcp__${ECO_IMAGE_VIEW_MCP_SERVER}__${ECO_IMAGE_VIEW_TOOL}` as const;

export function isEcoImageViewToolName(value: string | undefined): boolean;
export function readImageViewPathFromToolArgs(
  toolName: string | undefined,
  input: unknown,
): string | undefined;

export function buildImageViewPromptAppend(): string;
```

`buildImageViewPromptAppend` 放在 Desktop shared（宿主提示），runtime 只放识别与路径。Desktop shared 从 `@eco/runtime` 再导出三个常量，避免两套字符串。

- [ ] **Step 1: Write the failing tests**

`packages/runtime/test/eco-image-view-tool.test.ts`:

```typescript
import { expect, test } from "bun:test";
import {
  ECO_IMAGE_VIEW_FULL_TOOL,
  ECO_IMAGE_VIEW_MCP_SERVER,
  ECO_IMAGE_VIEW_TOOL,
  isEcoImageViewToolName,
  readImageViewPathFromToolArgs,
} from "../src/eco-image-view-tool";

test("recognizes Eco image view MCP names", () => {
  expect(isEcoImageViewToolName(ECO_IMAGE_VIEW_FULL_TOOL)).toBe(true);
  expect(isEcoImageViewToolName(`mcp__${ECO_IMAGE_VIEW_MCP_SERVER}__${ECO_IMAGE_VIEW_TOOL}`)).toBe(true);
  expect(isEcoImageViewToolName("mcp__eco_image_generation__create_image")).toBe(false);
  expect(isEcoImageViewToolName("ViewImage")).toBe(false);
  expect(isEcoImageViewToolName("view_image")).toBe(false);
});

test("readImageViewPathFromToolArgs only returns absolute paths for Eco view_image", () => {
  expect(readImageViewPathFromToolArgs(ECO_IMAGE_VIEW_FULL_TOOL, { path: "/tmp/a.png" })).toBe(
    "/tmp/a.png",
  );
  expect(readImageViewPathFromToolArgs(ECO_IMAGE_VIEW_FULL_TOOL, { path: "relative.png" })).toBe(
    undefined,
  );
  expect(readImageViewPathFromToolArgs("Read", { path: "/tmp/a.png" })).toBe(undefined);
});
```

`apps/desktop/test/image-view-tool.test.ts`:

```typescript
import { expect, test } from "bun:test";
import { ECO_IMAGE_VIEW_FULL_TOOL } from "@eco/runtime";
import { buildImageViewPromptAppend } from "../src/shared/image-view-tool";

test("prompt append names the Eco view_image tool and does not mention integrations", () => {
  const text = buildImageViewPromptAppend();
  expect(text).toContain(ECO_IMAGE_VIEW_FULL_TOOL);
  expect(text).toContain("absolute");
  expect(text.toLowerCase()).not.toContain("integration");
  expect(text).toContain("view_image");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
bun test packages/runtime/test/eco-image-view-tool.test.ts apps/desktop/test/image-view-tool.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

`packages/runtime/src/eco-image-view-tool.ts`:

```typescript
import path from "node:path";

export const ECO_IMAGE_VIEW_MCP_SERVER = "eco_image_view" as const;
export const ECO_IMAGE_VIEW_TOOL = "view_image" as const;
export const ECO_IMAGE_VIEW_FULL_TOOL =
  `mcp__${ECO_IMAGE_VIEW_MCP_SERVER}__${ECO_IMAGE_VIEW_TOOL}` as const;

export function isEcoImageViewToolName(value: string | undefined): boolean {
  const name = value?.trim().toLowerCase() ?? "";
  if (!name) return false;
  return name.includes(ECO_IMAGE_VIEW_MCP_SERVER);
}

export function readImageViewPathFromToolArgs(
  toolName: string | undefined,
  input: unknown,
): string | undefined {
  if (!isEcoImageViewToolName(toolName)) return undefined;
  if (!input || typeof input !== "object" || Array.isArray(input)) return undefined;
  const raw = (input as Record<string, unknown>).path;
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  if (!trimmed || !path.isAbsolute(trimmed)) return undefined;
  return trimmed;
}
```

`apps/desktop/src/shared/image-view-tool.ts`:

```typescript
import { ECO_IMAGE_VIEW_FULL_TOOL } from "@eco/runtime";

export {
  ECO_IMAGE_VIEW_FULL_TOOL,
  ECO_IMAGE_VIEW_MCP_SERVER,
  ECO_IMAGE_VIEW_TOOL,
  isEcoImageViewToolName,
} from "@eco/runtime";

export function buildImageViewPromptAppend(): string {
  return [
    "Built-in local image viewing (Eco) is always available.",
    `To inspect a local image file, use only \`${ECO_IMAGE_VIEW_FULL_TOOL}\` with an absolute path.`,
    "The tool returns a structured text report, not pixels. Do not attach image bytes to the main conversation.",
    "On Codex, prefer this Eco tool over the native view_image when you need the Eco vision model; the native viewer may still appear.",
  ].join("\n");
}
```

Export from `packages/runtime/src/index.ts`.

- [ ] **Step 4: Run tests to verify they pass**

Run the same `bun test` command. Expected: PASS.

- [ ] **Step 5: Commit** (only if the user asked to commit)

```bash
git add packages/runtime/src/eco-image-view-tool.ts packages/runtime/test/eco-image-view-tool.test.ts packages/runtime/src/index.ts apps/desktop/src/shared/image-view-tool.ts apps/desktop/test/image-view-tool.test.ts
git commit -m "feat: add Eco view_image tool identifiers"
```

---

### Task 2: Feed 把 Eco 看图工具投影成 ImageView

**Files:**
- Modify: `packages/runtime/src/codex-event-adapter.ts`（`emitMcpToolEvent`）
- Modify: `packages/runtime/test/codex-event-adapter.test.ts`
- Modify: `apps/desktop/src/main/sdk-stream-activity.ts`（`resolveSdkToolUseMetadata` / summary / failed）
- Modify: `apps/desktop/test/thread-run-projection-view.test.ts`
- Modify: `apps/desktop/test/activity-log-view-loading.test.ts`
- Modify: `apps/desktop/src/shared/activity-display.ts`
- Modify: `apps/desktop/src/renderer/activity-log.ts`
- Modify: `apps/desktop/test/activity-display.test.ts`
- Modify: `apps/mobile/test/activity_feed_test.dart`

**Interfaces:**
- Consumes: `isEcoImageViewToolName`, `readImageViewPathFromToolArgs` from Task 1
- Produces: `metadata.tool.imageView = { path }` on Eco `view_image` tool events when path is absolute. Existing `ImageViewBlock` / Mobile `ActivityFeedKind.imageView` 无需改组件。

- [ ] **Step 1: Write the failing tests**

Append to `packages/runtime/test/codex-event-adapter.test.ts`（仿现有 `imageView items project as image-view tool lifecycle events`，但 itemType 为 `mcpToolCall`）:

```typescript
test("eco_image_view MCP calls project imageView metadata from absolute path arguments", () => {
  const events = collectEvents((record) => {
    const adapter = new CodexEventAdapter({ resolveEcoThreadId, recordThreadRunEvent: record });
    adapter.dispatch("item/started", {
      threadId: CODEX_THREAD,
      turnId: "turn_mcp_view",
      item: {
        id: "item_mcp_view_1",
        type: "mcpToolCall",
        server: "eco_image_view",
        tool: "view_image",
        arguments: { path: "/tmp/shot.png", question: "找报错" },
      },
    });
  });
  expect(events[0]?.metadata?.tool).toEqual(
    expect.objectContaining({
      name: "mcp__eco_image_view__view_image",
      imageView: { path: "/tmp/shot.png" },
    }),
  );
});

test("eco_image_view MCP calls with relative path do not attach imageView", () => {
  const events = collectEvents((record) => {
    const adapter = new CodexEventAdapter({ resolveEcoThreadId, recordThreadRunEvent: record });
    adapter.dispatch("item/started", {
      threadId: CODEX_THREAD,
      turnId: "turn_mcp_rel",
      item: {
        id: "item_mcp_rel",
        type: "mcpToolCall",
        server: "eco_image_view",
        tool: "view_image",
        arguments: { path: "shot.png" },
      },
    });
  });
  expect(events[0]?.metadata?.tool?.imageView).toBeUndefined();
});
```

Desktop projection test（`apps/desktop/test/thread-run-projection-view.test.ts`）: 复制现有 `imageView projects as an independent image Feed entry`，把 `toolName` 换成 `mcp__eco_image_view__view_image`，`itemType` 为 `mcpToolCall`。

`apps/desktop/test/activity-display.test.ts` 增加：

```typescript
expect(formatToolDisplayLabel("mcp__eco_image_view__view_image")).toBe("查看图像");
```

`apps/desktop/test/activity-log-view-loading.test.ts` 在 `iconForToolName("ViewImage")` 旁加：

```typescript
expect(iconForToolName("mcp__eco_image_view__view_image")).toBe("image");
```

Mobile：在 `apps/mobile/test/activity_feed_test.dart` 的 `projects imageView as an independent entry` 旁增加一条，`name: mcp__eco_image_view__view_image`，`imageView.path` 相同，断言 `ActivityFeedKind.imageView`。

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun test packages/runtime/test/codex-event-adapter.test.ts apps/desktop/test/thread-run-projection-view.test.ts apps/desktop/test/activity-display.test.ts apps/desktop/test/activity-log-view-loading.test.ts
```

Expected: FAIL — MCP 事件没有 `imageView`，标签不是「查看图像」。

- [ ] **Step 3: Write minimal implementation**

在 `emitMcpToolEvent` 里，`toolName = mcp__${server}__${tool}` 之后：

```typescript
import { readImageViewPathFromToolArgs } from "./eco-image-view-tool.js";

const imageViewPath = readImageViewPathFromToolArgs(toolName, mcpInput);
```

`tool` metadata 增加 `...(imageViewPath ? { imageView: { path: imageViewPath } } : {})`。`detail` 在有 path 时用 path（与原生 ViewImage 的 `Tool: … · /path` 一致）。

`resolveSdkToolUseMetadata`（以及 summary / failed，failed 也保留 path 以便预览可留在失败态）:

```typescript
import { readImageViewPathFromToolArgs } from "@eco/runtime";

const imageViewPath = readImageViewPathFromToolArgs(name, record.input);
// ...
...(imageViewPath && { imageView: { path: imageViewPath } }),
```

`activity-display.ts` 的 `MCP_TOOL_DISPLAY_LABELS` 增加：

```typescript
mcp__eco_image_view__view_image: "查看图像",
```

`ECO_BUILTIN_TOOL_SUFFIX_LABELS` 增加 `view_image: "查看图像"`。`resolveEcoBuiltinToolLabel` 在 `isEcoImageGenerationToolName` 旁对 `isEcoImageViewToolName` 返回「查看图像」。

`activity-log.ts` 的 `iconForToolCategory` 分支：`name === "viewimage" || isEcoImageGenerationToolName(tool)` 改为同时 `|| isEcoImageViewToolName(tool)`。

Desktop projection 已从 `metadata.tool.imageView` 渲染，无需改 `ImageViewBlock`。

- [ ] **Step 4: Run tests to verify they pass**

Same bun test command, plus:

```bash
cd apps/mobile && dart test test/activity_feed_test.dart
```

Expected: PASS.

- [ ] **Step 5: Commit** (only if the user asked)

```bash
git commit -m "feat: project Eco view_image MCP results as ImageView"
```

---

### Task 3: 抽出可复用的视觉分析（贴图拦截行为不变）

**Files:**
- Create: `apps/desktop/src/main/vision-analysis.ts`
- Create: `apps/desktop/test/vision-analysis.test.ts`
- Modify: `apps/desktop/src/main/index.ts`（`resolvePromptImagesForMainContext` 改为调用抽出函数；删除重复的 proxy fetch）
- Modify: `apps/desktop/test/prompt-image-vision.test.ts`（保持现有断言仍过）

**Interfaces:**
- Consumes: `readImageViewFile`, `buildVisionAnalysisRequestBody`, `readVisionAnalysisResponse`, `startRuntimeProxy`, `BUILTIN_VISION_AGENT_ROLE`, existing route resolution
- Produces:

```typescript
export interface VisionAnalysisRequest {
  threadId: string;
  prompt: string;
  attachments: readonly PromptImageAttachment[];
  billingAgentId: string;
  emitSubagentLifecycle: boolean;
  signal?: AbortSignal;
  routesOverride?: readonly RuntimeRoleRouteConfig[];
}

export async function runVisionAnalysis(input: VisionAnalysisRequest): Promise<string>;
```

当 `emitSubagentLifecycle === true` 时，行为必须与当前 `resolvePromptImagesForMainContext` 的子代理生命周期一致（start/stop、missionKey `prompt-images:N`、Feed 看图子代理卡片）。当 `false` 时：只 register/unregister `proxyBillingStampRegistry`（role `vision`），**禁止** `agentLifecycle.startSubagent` / `appendThreadRunEvent` 的 `agent.started`。

`runVisionAnalysis` 在 `supportsImageInput === false` 或没有 route 时抛错，文案与现有「看图子代理缺少可用的模型路由 / 已明确配置为不支持图片输入」一致。

- [ ] **Step 1: Write the failing tests**

`apps/desktop/test/vision-analysis.test.ts` 用注入 deps 或把 route 解析 / fetch 做成可 mock 的入参。最小可测的纯逻辑若难测 HTTP，则测：

1. `emitSubagentLifecycle: false` 的包装函数不调用 `startSubagent`（把 lifecycle 写成 deps）。
2. `supportsImageInput: false` 抛错且不调用 fetch。

把 `runVisionAnalysis` 的副作用放到 `VisionAnalysisHost` 接口：

```typescript
export interface VisionAnalysisHost {
  resolveRoute(threadId: string, routesOverride?: readonly RuntimeRoleRouteConfig[]): RuntimeRoute;
  startProxy(route: RuntimeRoute, attachments: readonly PromptImageAttachment[], stamp: {
    threadId: string;
    runAttemptId?: string;
  }): Promise<{ baseUrl: string; apiKey: string; aliasModelId: string; close(): Promise<void> }>;
  registerBilling(threadId: string, agentId: string): void;
  unregisterBilling(threadId: string, agentId: string): void;
  emitSubagentStart(input: { threadId: string; agentId: string; imageCount: number }): void;
  emitSubagentStop(input: { threadId: string; agentId: string; imageCount: number; failed: boolean; report?: string }): void;
}
```

测试提供 fake host。

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test apps/desktop/test/vision-analysis.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement extract + rewire prompt images**

将 `index.ts` 里 `resolvePromptImagesForMainContext` 的 proxy/`/v1/messages` 段搬到 `vision-analysis.ts`。`index.ts` 实现 `VisionAnalysisHost` 并：

- 无附件：仍直接 `return input.prompt`
- 有附件：`emitSubagentLifecycle: true`，`billingAgentId = vision:${threadId}:${uuid}`，成功后 `buildPromptWithVisionAnalysis`

贴图拦截的并发闸、`conversationStore.upsertSubagentSessionActive` 等留在 host 的 `emitSubagentStart/Stop` 里，不要漏。

- [ ] **Step 4: Run tests**

```bash
bun test apps/desktop/test/vision-analysis.test.ts apps/desktop/test/prompt-image-vision.test.ts
```

Expected: PASS。若有覆盖 `resolvePromptImagesForMainContext` 的 Desktop 测试，一并跑。

- [ ] **Step 5: Commit** (only if asked)

```bash
git commit -m "refactor: extract shared vision analysis for prompt images and view_image"
```

---

### Task 4: MCP 网关实现 `view_image`

**Files:**
- Create: `apps/desktop/src/main/image-view-mcp-gateway.ts`
- Create: `apps/desktop/packaging/eco-image-view-mcp-stdio.mjs`
- Create: `apps/desktop/test/image-view-mcp-gateway.test.ts`
- Modify: `apps/desktop/electron-builder.yml`（extraResources 增加 stdio，仿 `eco-image-generation-mcp-stdio.mjs`）

**Interfaces:**
- Consumes: Task 1 常量、`readImageViewFile`、Task 3 `runVisionAnalysis` via injected `analyze`
- Produces:

```typescript
export interface ImageViewMcpInjection {
  enabled: true;
  serverName: typeof ECO_IMAGE_VIEW_MCP_SERVER;
  sdkEntry: Record<string, unknown>;
  codexServer: CodexMcpServerForConfigSync;
  promptAppend: string;
}

export class ImageViewMcpGateway {
  constructor(deps: {
    analyze(input: {
      threadId: string;
      path: string;
      question?: string;
      toolUseId?: string;
    }): Promise<string>;
  });
  resolveGlobalCodexServer(): Promise<CodexMcpServerForConfigSync>;
  resolveInjection(threadId: string): Promise<ImageViewMcpInjection>; // always enabled
  mergeIntoSdkConfig(base: McpSdkConfig, injection: ImageViewMcpInjection): McpSdkConfig;
  noteUpcomingTool(threadId: string, toolName?: string, toolUseId?: string): void;
  noteThreadPrompt(threadId: string, prompt: string): void;
  disposeThread(threadId: string): void;
  close(): Promise<void>;
}
```

`mergeIntoSdkConfig` **必须把** `ECO_IMAGE_VIEW_FULL_TOOL` **加入** `allowedTools`（与生图相反）。

工具 schema：`path` required string；`question` optional string。

Control `/v1/tools/call` 顺序：

1. 绑定 thread（auth / claim，抄生图 `BrowserMcpAuthRegistry` + `BrowserMcpToolClaimRouter`，工具名 `view_image`）
2. 校验 `path` 为绝对路径；否则 MCP `isError: true`，文案用 ImageView `invalid_path` 语义
3. `readImageViewFile(path)`；失败则 `isError`，把 `ImageViewReadError.code` 映射到现有 i18n 同义中文（可在 gateway 内用固定中文，与 `activity.imageView.error.*` 一致）
4. 将文件转为 `PromptImageAttachment`，`analyze({ threadId, path, question: question ?? lastThreadPrompt })`
5. 成功：`content: [{ type: "text", text: report }]`，不要返回 base64

`analyze` 由 `index.ts` 实现：`emitSubagentLifecycle: false`。`supportsImageInput === false` / 无路由在 `analyze` 里抛错，gateway 变成 `isError`，此时若读盘已成功，Feed 侧已有绝对 path 的 ImageView（Task 2）。

stdio 脚本复制 `eco-image-generation-mcp-stdio.mjs`，改 env 名为 `ECO_IMAGE_VIEW_CONTROL_URL` / `ECO_IMAGE_VIEW_CONTROL_SECRET` / `ECO_IMAGE_VIEW_AUTH_TOKEN`，`serverInfo.name = eco_image_view`。

- [ ] **Step 1: Write the failing tests**

对照 `apps/desktop/test/image-generation-mcp-gateway.test.ts`：

- `resolveGlobalCodexServer` 稳定、有 control URL
- `mergeIntoSdkConfig` 含 `mcp__eco_image_view__view_image`
- HTTP call：mock `analyze`；相对路径不调用 `analyze`，`isError`
- HTTP call：绝对路径调用 `analyze` 一次，返回报告文本，JSON 中无 `data:image` / 长 base64

需要把 `handle` 测到：可对 gateway 的 control HTTP 发 POST（测生图网关若没有 call 测试，就在本测试里 `fetch` control URL）。看 `image-generation-mcp-gateway.test.ts` 只测了 global server；本任务必须测 call 路径，否则读盘/分析缺口会被掩盖。

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test apps/desktop/test/image-view-mcp-gateway.test.ts
```

Expected: FAIL — class not found.

- [ ] **Step 3: Implement gateway + stdio + extraResources**

`electron-builder.yml` extraResources 增加：

```yaml
  - from: packaging/eco-image-view-mcp-stdio.mjs
    to: eco-image-view-mcp-stdio.mjs
```

stdio 解析路径与生图相同（`app.getAppPath()/packaging/...` 与 `process.resourcesPath/eco-image-view-mcp-stdio.mjs`）。

- [ ] **Step 4: Run tests**

```bash
bun test apps/desktop/test/image-view-mcp-gateway.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit** (only if asked)

```bash
git commit -m "feat: add always-on Eco view_image MCP gateway"
```

---

### Task 5: 三个 runtime 始终注入（无集成开关）

**Files:**
- Modify: `apps/desktop/src/main/index.ts`
  - `resolveCodexGlobalMcpServers` 的 `builtinServerResolvers` 增加 `() => imageViewGateway.resolveGlobalCodexServer()`
  - Codex / Claude / Pi 三条注入路径：始终 `resolveInjection`，不读 `integrationsEnabled`
  - `buildDesktopSdkRunInput` / Codex `resolveSystemPromptAppend` / Pi `appendSystemPrompt` 始终追加 `buildImageViewPromptAppend()`
  - 每轮 run 开始 `imageViewGateway.noteThreadPrompt(threadId, prompt)`
  - `noteUpcomingTool` 对 Eco 看图工具名与生图并列
  - `disposeThread` / `close` 对称生图
- Modify: `apps/desktop/src/main/pi-mcp-session.ts` — 增加 `imageViewInject`（或复用通用 builtin inject），**始终** merge server + prompt；过滤用户 MCP 时排除 `ECO_IMAGE_VIEW_MCP_SERVER` 以免用户配置覆盖
- Modify: `apps/desktop/test/pi-mcp-session.test.ts`
- Modify: `apps/desktop/test/codex-global-mcp-wiring.test.ts`
- Modify: `apps/desktop/test/mcp-runtime.test.ts`（若断言 builtin 列表）
- Modify: Claude session builder 测试（搜 `mergeIntoSdkConfig` / `eco_image_generation` 的测试并加对称断言）

**Interfaces:**
- Consumes: Task 4 gateway
- Produces: 任意 Agent run（含 Ask/Plan）MCP 配置含 `eco_image_view`，与 `integrationsEnabled` 无关

- [ ] **Step 1: Write the failing tests**

`codex-global-mcp-wiring.test.ts` 增加：

```typescript
expect(source).toContain("imageViewGateway.resolveGlobalCodexServer()");
```

`pi-mcp-session.test.ts`：即使 `browserInject/imageInject` 均为 `{ enabled: false }`，在传入 `imageViewInject: { enabled: true, sdkEntry, promptAppend }` 后 `mcpServers` 含 `eco_image_view`，`appendSystemPrompt` 含 prompt。再加一条：Composer 未选任何集成时，只要测试传入 enabled imageView inject，仍出现该 server。

再写 `apps/desktop/test/image-view-injection.test.ts`（读 `index.ts` 源码或测 `buildPiMcpSessionConfig` / Claude merge helper）：断言 **没有** `integrationEnabled(..., "imageView")` 这类调用；注入不在 `INTEGRATION_IDS`。

检查 `apps/desktop/src/shared/integrations.ts` 的测试：`INTEGRATION_IDS` 仍只有 `browser` | `imageGeneration`。

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun test apps/desktop/test/codex-global-mcp-wiring.test.ts apps/desktop/test/pi-mcp-session.test.ts
```

Expected: FAIL — 源码尚未引用 `imageViewGateway`。

- [ ] **Step 3: Wire injection**

在 `index.ts` 于 `imageGenerationGateway` 旁创建 `imageViewGateway`。Claude `mergeIntoSdkConfig` 在 image gen 之后再 merge image view。`runtimeMcpServers` 数组始终包含 `ECO_IMAGE_VIEW_MCP_SERVER`。

Codex run 里 `resolveMcpServers`：`globalPool` 已含该 server（builtin resolver）。不要按 session 开关 strip。

Pi：`buildPiMcpSessionConfig` 增加参数 `imageViewInject`，实现与 `imageInject` 相同的 merge，但调用方始终 `enabled: true`。

`createSdkDriver` / permission 的 allowedTools 通过 `mergeIntoSdkConfig` 已包含该工具。

缺口：若某条 run 路径只注入 browser/image gen、漏了第三条，测试必须点名该文件函数。实现时 grep `imageGenerationGateway.resolveInjection` 的每一处，旁边都加 image view。

- [ ] **Step 4: Run tests**

```bash
bun test apps/desktop/test/codex-global-mcp-wiring.test.ts apps/desktop/test/pi-mcp-session.test.ts apps/desktop/test/mcp-runtime.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit** (only if asked)

```bash
git commit -m "feat: always inject Eco view_image MCP into Claude, Pi, and Codex"
```

---

### Task 6: 默认放行权限

**Files:**
- Modify: `apps/desktop/src/main/codex-approval-bridge.ts` — `handleMcpServerElicitationRequest` 在 image gen 分支之前：`serverName === eco_image_view` 且 tool 为 `view_image` 且 `mode === "form"` → `{ action: "accept", content: {} }`
- Modify: `apps/desktop/test/codex-approval-bridge-auto.test.ts`
- Modify: `apps/desktop/test/image-view-mcp-gateway.test.ts`（或 Task 4 的 merge 测试）断言 `allowedTools` **包含** `ECO_IMAGE_VIEW_FULL_TOOL`，且生图 merge **不包含** `create_image`
- Pi：无额外门；与 Claude 共用 `allowedTools`

**Interfaces:**
- Consumes: `isEcoImageViewToolName`, `ECO_IMAGE_VIEW_MCP_SERVER`, `ECO_IMAGE_VIEW_TOOL`
- Produces: 三个 runtime 对 Eco 看图工具自动放行；`create_image` 行为不变

缺口：Codex 若还有非 `mcpServer/elicitation/request` 的 MCP 审批入口，必须搜 `codex-approval-bridge.ts` 全部 MCP 相关 case 并同样放行。测不到的入口在测试注释里写「未覆盖」，不要声称底层已关。

- [ ] **Step 1: Write the failing tests**

`codex-approval-bridge-auto.test.ts` 仿 browser auto-accept / image gen 测试：

```typescript
test("auto-accepts eco_image_view view_image elicitation without a bash card", async () => {
  const events: Array<{ type: string }> = [];
  const result = await handleCodexServerRequest(deps, CODEX_MCP_SERVER_ELICITATION_REQUEST, {
    threadId: "codex-thread-view",
    turnId: "turn-view",
    serverName: "eco_image_view",
    mode: "form",
    message: 'Allow the MCP server to run tool "view_image"',
    requestedSchema: {},
  });
  expect(result).toEqual({ action: "accept", content: {} });
  expect(events.some((event) => event.type === "bash_approval.requested")).toBe(false);
});
```

Claude：对 `createImageViewToolPermissionHandler`（或 compose 后的 handler）请求 `toolName: ECO_IMAGE_VIEW_FULL_TOOL`，`bashReviewMode` 无关，返回 allow。同文件对照 `create_image` 仍会 `bash_approval.requested`（可继续用现有 image generation permission 测试，不要改坏）。

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun test apps/desktop/test/codex-approval-bridge-auto.test.ts
```

Expected: FAIL — elicitation 走进通用 MCP 表单，不是 auto-accept。

- [ ] **Step 3: Implement auto-allow**

在 `handleMcpServerElicitationRequest`，`shouldAutoAcceptEcoBrowserToolElicitation` 之后、image gen 确认卡之前：

```typescript
if (
  mode === "form" &&
  serverName.trim().toLowerCase() === ECO_IMAGE_VIEW_MCP_SERVER &&
  parseMcpToolRunElicitationMessage(serverName, message)?.endsWith(`__${ECO_IMAGE_VIEW_TOOL}`)
) {
  return { action: "accept", content: {} };
}
```

`composeCanUseToolHandlers`（`packages/runtime/src/ask-user-question.ts`）会依次跑完所有 handler，只有 `deny` 才中断。Bash handler 对非 `Bash` 直接放行。不要加空的 allow handler。

Claude 的放行条件：

- Task 4 `mergeIntoSdkConfig` **包含** `ECO_IMAGE_VIEW_FULL_TOOL`（生图是故意从 `allowedTools` 去掉的，看图相反）
- 测试：`bashReviewMode: always` 时 SDK options / merged config 含该工具；`create_image` 仍不在 `allowedTools` 中

Codex 的放行条件：elicitation auto-accept（上面的分支）。PI 使用同一套 Claude `allowedTools` + permission compose，无额外门。

- [ ] **Step 4: Run tests**

```bash
bun test apps/desktop/test/codex-approval-bridge-auto.test.ts apps/desktop/test/image-generation-activity.test.ts
```

以及任何新的 permission 测试。Expected: PASS；生图仍要确认。

- [ ] **Step 5: Commit** (only if asked)

```bash
git commit -m "feat: auto-allow Eco view_image without bash review"
```

---

## Spec coverage

| Spec 要求 | Task |
|-----------|------|
| 始终注入 MCP，非集成开关 | 5 |
| `view_image(path, question?)` | 1, 4 |
| 复用 `readImageViewFile` | 4 |
| 复用视觉路由 / 隔离报告 | 3, 4 |
| Feed 复用 ImageView | 2 |
| 贴图拦截不变 | 3 |
| 不计子代理生命周期 | 3 (`emitSubagentLifecycle: false`), 4 |
| 计费 `role: vision` | 3 billing stamp |
| 默认 allow | 6 |
| Ask/Plan 可用 | 5（所有 run 都注入；工具只读） |
| Codex 原生并存 | 2 不改 native `imageView` item 测试 |
| 主 Agent 提示 | 1 prompt + 5 追加 |
| 打包 stdio | 4 electron-builder |
| Desktop + Mobile Feed 测 MCP 名 | 2 |

## 已知缺口（实现时不得用兜底假装解决）

- Codex 原生 `view_image` 关不掉；可能与 Eco 工具各出一张 ImageView。
- Codex 非 elicitation 的 MCP 审批入口若存在，Task 6 必须点名覆盖或写明未测。
- 绝对路径但文件不存在：Feed 走 ImageView 错误态，不是「完全无卡片」。
- Mobile 不实现 MCP 网关；只消费同一 `imageView` metadata。Desktop 宿主才跑视觉模型。
