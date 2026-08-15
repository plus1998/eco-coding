# ACP 宿主与 Cursor ACP 接入 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用 ACP（`agent acp`）全面替换 stream-json Cursor 集成：runtime 建 ACP 宿主，`coreKind: "acp"` + `acpAgentId: "cursor"`，UI 标「ACP」，保留 opt-in 门禁；审批/Plan 仅占位。

**Architecture:** Runtime 提供 stdio JSON-RPC ACP client（initialize → notifications/initialized → session/new|load → session/prompt → 通知流），映射为 Eco `AgentEvent`。Cursor adapter 只负责 spawn `agent acp`。Desktop 用 `acp-runtime-run` 编排；删除 `CursorAgentDriver` 与一等 `coreKind: "cursor"`。

**Tech Stack:** TypeScript, Bun tests, Node `child_process` stdio, Cursor CLI `agent acp`（本机已验证 `protocolVersion: 1`，`loadSession: true`）。

**Spec:** [docs/superpowers/specs/2026-08-15-acp-host-cursor-design.md](../specs/2026-08-15-acp-host-cursor-design.md)

## Global Constraints

- Label 固定为 **ACP**（不翻译）；显示「Cursor · ACP」。不再用「外置」。
- `CORE_KINDS` = `claude | codex | pi | acp`；**禁止**保留一等 `"cursor"`。
- 线程：`coreKind === "acp"` 时必须有 `acpAgentId`（MVP 仅 `"cursor"`）。
- **全面替换** stream-json；删除 `CursorAgentDriver` / NDJSON 路径；不双轨。
- Opt-in：`showAcpCursor = acpAgentsEnabled.cursor === true && cursorAcp.available`。
- 探测验收目标：ACP **最小握手**（initialize + initialized）；过渡可用 models，但须标技术债。
- 续跑：Cursor 声明 `loadSession: true`；用 `session/load`（或协议等价）；失败则**明确报缺口**，不假装成功。
- mode（plan/ask）：能传则传；不能则记已知缺口，不静默宣称支持。
- 审批/Plan：capability 标 `unsupported` 或 `planned`；不接完整审批卡。
- 旧 `coreKind: "cursor"` 读时静默升级为 `acp` + `acpAgentId: "cursor"`。
- 工作区若已有未提交的 stream-json / 「外置」WIP：**在对应任务中删除或改写**，勿与 ACP 并存。
- 用户未明确要求时不要 git commit。
- TDD：每个行为先失败测试再实现。

### 本机已探明的 ACP 事实（实现须再验证）

```
→ initialize { protocolVersion: 1, clientCapabilities, clientInfo }
← result { protocolVersion: 1, agentCapabilities: { loadSession: true, ... }, authMethods }
→ notifications/initialized
→ session/new { cwd, mcpServers: [] }
```

`session/new` 会写 `~/.cursor/acp-sessions`（沙箱可能 EPERM）。勿在沙箱里当「协议错误」。

---

## File map

| File | Responsibility |
|------|----------------|
| Modify `packages/runtime/src/core-runtime.ts` | `cursor` → `acp`；ACP capability 占位 |
| Create `packages/runtime/src/acp-types.ts` | JSON-RPC / session 类型；`AcpAgentId` |
| Create `packages/runtime/src/acp-jsonrpc.ts` | 一行一条 JSON 的 stdio 传输 |
| Create `packages/runtime/src/acp-client.ts` | initialize / session / prompt / cancel / 通知订阅 |
| Create `packages/runtime/src/acp-event-map.ts` | ACP 通知 → `AgentEvent` |
| Create `packages/runtime/src/acp-cursor-agent.ts` | spawn `agent acp` + resolve executable |
| Delete `packages/runtime/src/cursor-agent-driver.ts`（及 models 若仅服务旧路径则迁走） | 废弃 stream-json |
| Modify `packages/runtime/src/index.ts` + `package.json` exports | 导出 ACP；去掉旧 cursor-driver export |
| Create `apps/desktop/src/main/acp-runtime-run.ts` | 替代 `cursor-runtime-run.ts` |
| Delete `apps/desktop/src/main/cursor-runtime-run.ts` | 废弃 |
| Modify/replace `cursor-core-availability.ts` → `acp-cursor-availability.ts` | 握手探测 + opt-in helpers |
| Modify workflow-settings / ipc / index / App / Sidebar / DefaultAgent / i18n / tests | `acp` 模型 + 门禁 + UI |

---

### Task 1: CoreKind `acp` + 类型；移除一等 `cursor`

**Files:**
- Modify: `packages/runtime/src/core-runtime.ts`
- Modify: 所有 `CORE_KINDS` / `"cursor"` 引用的编译点（先改类型，后续任务接完编译）
- Test: `packages/runtime/test/core-runtime-acp.test.ts`（小测 `isCoreKind` / constants）

**Interfaces:**
- `CORE_KINDS = ["claude", "codex", "pi", "acp"]`
- `export type AcpAgentId = "cursor"`（可扩展联合类型）
- ACP capability：`toolApproval: "unsupported"`（或 `"planned"`，与现有 `CoreCapabilitySupport` 对齐；若类型不允许 planned，用 `unsupported` 并注释）

- [ ] **Step 1: Write failing test** — `expect(CORE_KINDS).toContain("acp"); expect(CORE_KINDS).not.toContain("cursor")`
- [ ] **Step 2: Run fail**
- [ ] **Step 3: Change core-runtime.ts**；暂时让 desktop 仍引用 cursor 的文件用 `@ts-expect-error` 或同步改成 acp 占位字符串以免整仓无法测 —— **优先**：本任务只改 runtime 常量 + 导出；desktop 编译错误在 Task 5+ 清。
- [ ] **Step 4: Pass runtime test**
- [ ] **Step 5: Commit**（仅当用户要求）

---

### Task 2: ACP JSON-RPC 传输

**Files:**
- Create: `packages/runtime/src/acp-jsonrpc.ts`
- Test: `packages/runtime/test/acp-jsonrpc.test.ts`

**Interfaces:**

```typescript
export type JsonRpcId = string | number;
export interface JsonRpcRequest { jsonrpc: "2.0"; id: JsonRpcId; method: string; params?: unknown }
export interface JsonRpcNotification { jsonrpc: "2.0"; method: string; params?: unknown }
export interface JsonRpcSuccess { jsonrpc: "2.0"; id: JsonRpcId; result: unknown }
export interface JsonRpcError { jsonrpc: "2.0"; id: JsonRpcId; error: { code: number; message: string; data?: unknown } }

export function encodeJsonRpcLine(message: object): string; // JSON + "\n"
export function parseJsonRpcLine(line: string): object | undefined;
export class AcpJsonRpcPeer {
  constructor(io: { write: (line: string) => void; onLine: (cb: (line: string) => void) => void })
  request(method: string, params?: unknown, timeoutMs?: number): Promise<unknown>
  notify(method: string, params?: unknown): void
  onNotification(method: string, handler: (params: unknown) => void): () => void
  dispose(): void
}
```

- [ ] **Step 1: Failing tests** — encode/parse；request 匹配 id；notification 分发；未知行忽略
- [ ] **Step 2–4: Implement + pass**
- [ ] **Step 5: Commit**（仅当用户要求）

---

### Task 3: ACP Client（握手 + session + prompt 骨架）

**Files:**
- Create: `packages/runtime/src/acp-types.ts`
- Create: `packages/runtime/src/acp-client.ts`
- Test: `packages/runtime/test/acp-client.test.ts`（用 mock peer，不强制起真 `agent`）

**Interfaces:**

```typescript
export interface AcpClientOptions {
  peer: AcpJsonRpcPeer;
  clientInfo?: { name: string; version: string };
}

export class AcpClient {
  constructor(options: AcpClientOptions)
  initialize(): Promise<AcpInitializeResult> // protocolVersion 1
  /** 发送 notifications/initialized */
  confInitialized(): void
  newSession(input: { cwd: string; mcpServers?: unknown[] }): Promise<{ sessionId: string }>
  loadSession(input: { sessionId: string; cwd: string }): Promise<void> // 若方法名不同，以 Cursor 实测为准并在此固定
  prompt(input: { sessionId: string; prompt: unknown }): Promise<unknown>
  cancel(input: { sessionId: string }): Promise<void>
  onSessionUpdate(handler: (params: unknown) => void): () => void
}
```

方法名以 Cursor 实测为准；计划默认：

- `initialize`
- `notifications/initialized`
- `session/new`
- `session/load`（因 `loadSession: true`；若不存在则 client 抛明确错误 `ACP_LOAD_SESSION_UNSUPPORTED`）
- `session/prompt`
- `session/cancel`
- 通知：常见为 `session/update`（实现时用一次真实探测锁定名字，写进测试 fixture）

- [ ] **Step 1: Failing tests** — mock peer 脚本化握手顺序；`newSession` 返回 sessionId
- [ ] **Step 2–4: Implement + pass**
- [ ] **Step 5: Commit**（仅当用户要求）

**缺口处理：** 若 `session/load` / `session/prompt` 参数形状与假设不符，在本任务报告写清实测 JSON，改接口，**禁止**用空 catch 吞掉。

---

### Task 4: ACP → Eco `AgentEvent` 映射

**Files:**
- Create: `packages/runtime/src/acp-event-map.ts`
- Test: `packages/runtime/test/acp-event-map.test.ts`

**Interfaces:**

```typescript
export function mapAcpSessionUpdate(
  params: unknown,
  ctx: { threadId: string; agentId: string; sessionRunId: string },
): AgentEvent[]
```

最小映射（有则测，无则 raw 透传 `terminal.output`）：

- 助手文本增量 → `message.delta`（`eco_stream`）
- 工具开始/结束 → `tool.started` / `tool.completed`
- 会话结束/错误 → `run.terminal`
- 其它 → `terminal.output` + `raw`（不丢字段）

用从真实 `agent acp` 录制的 1–2 条 fixture（可脱敏）锁行为。

- [ ] **Step 1–4: TDD**
- [ ] **Step 5: Commit**（仅当用户要求）

---

### Task 5: Cursor ACP adapter + 删除 stream-json driver

**Files:**
- Create: `packages/runtime/src/acp-cursor-agent.ts`
- Create: `packages/runtime/src/acp-agent-driver.ts`（`async *run` 编排：spawn → AcpClient → map events）
- Delete: `packages/runtime/src/cursor-agent-driver.ts`
- Move/keep: `cursor-agent-models.ts`（模型列表仍可用于设置页；改从 adapter 旁路调用 `agent models`，或后续改 ACP；MVP 允许保留 `listCursorAgentModels`）
- Update: `packages/runtime/src/index.ts`, `package.json` exports
- Delete/rewrite: `packages/runtime/test/cursor-agent-driver.test.ts` → ACP 测试
- Test: `packages/runtime/test/acp-cursor-agent.test.ts`（resolve executable + args `["acp"]`）

**Interfaces:**

```typescript
export function resolveCursorAgentExecutable(explicit?: string): string // 可从旧 driver 迁入
export function spawnCursorAcpProcess(options?: { executable?: string; env?: NodeJS.ProcessEnv; cwd?: string }): ChildProcess
export class AcpAgentDriver {
  async *run(input: {
    threadId: string;
    prompt: string;
    workspacePath: string;
    signal?: AbortSignal;
    acpAgentId: "cursor";
    resumeSessionId?: string;
    model?: string; // 若 ACP 无模型参数，忽略并在 payload 记缺口
  }): AsyncGenerator<AgentEvent>
  cancel(threadId: string): boolean
}
```

- [ ] **Step 1: Failing tests** for executable resolve + spawn args include `acp` not `--print`
- [ ] **Step 2: Implement driver；删除 stream-json 文件**
- [ ] **Step 3: Ensure no imports of deleted modules**
- [ ] **Step 4: Pass tests**
- [ ] **Step 5: Commit**（仅当用户要求）

---

### Task 6: Desktop `acp-runtime-run` + main 接线；去掉 cursor-runtime

**Files:**
- Create: `apps/desktop/src/main/acp-runtime-run.ts`
- Delete: `apps/desktop/src/main/cursor-runtime-run.ts`
- Modify: `apps/desktop/src/main/index.ts` — coordinator `kind: "acp"`；create/continue assert；删除 cursor 注册
- Modify: thread summary 类型含 `acpAgentId`（`ipc.ts` / conversation store）

**Behavior:**

- `requireThreadCore(thread, "acp", ...)`
- `acpAgentId` 默认/校验为 `"cursor"`
- `startAcpThreadRun` → `AcpAgentDriver.run`
- session.captured → 存 `externalSessionId`
- 续跑：`loadSession`；失败则 `markInterrupted` 明确文案（i18n）

- [ ] **Step 1: 抽出可测的 `resolveAcpThreadAgentId(thread): "cursor"` 纯函数并测**
- [ ] **Step 2–4: 接线 + 编译通过相关路径**
- [ ] **Step 5: Commit**（仅当用户要求）

---

### Task 7: Opt-in 设置迁移（`acpAgentsEnabled`）+ 握手探测

**Files:**
- Replace: `apps/desktop/src/main/cursor-core-availability.ts` → `acp-cursor-availability.ts`（或重写同文件）
- Modify: `workflow-settings-store.ts`, `ipc.ts`
- Tests: store + availability + gate（沿用 rising-edge save 语义）

**Settings:**

```typescript
acpAgentsEnabled?: { cursor?: boolean }
acpCursorModelId?: string
defaultAcpAgentId?: "cursor"
// 删除 cursorCoreEnabled / cursorModelId（读旧库时迁移一次）
```

**Probe（验收目标）：** spawn `agent acp` → initialize → initialized →（可选立刻 dispose）。成功 ⇒ `available: true`。  
**过渡债：** 若 CI 不能起进程，单元测 mock peer；集成测 `test.skip` 并注释原因。

Save 规则与已确认 opt-in 设计一致：仅 false→true 硬拒；已启用探测失败则对账关闭并继续保存其它字段。

- [ ] **Step 1–4: TDD + 实现**
- [ ] **Step 5: Commit**（仅当用户要求）

---

### Task 8: UI —「Cursor · ACP」+ 开关；静默升级

**Files:**
- `SidebarCoreSelector.tsx` — `coreKind: "acp"`，label ACP；`acpCoreVisible`
- `DefaultAgentSettingsPanel.tsx` — 启用 Cursor（ACP）
- `App.tsx` — `showAcpCursor` 接线
- `i18n-catalogs.ts` — 去掉外置；改为 ACP 文案
- 线程读路径：`coreKind === "cursor"` → 升级为 acp + cursor
- Tests: sidebar / default-agent / migration helper

显示：`Cursor · ACP`（`sidebar.acpLabel` = `"ACP"`）。

- [ ] **Step 1–4: TDD + 实现**
- [ ] **Step 5: Commit**（仅当用户要求）

---

### Task 9: 清扫与验收

**Files:** 全局 `rg` 清 `"cursor"` coreKind、外置、`CursorAgentDriver`、`stream-json` Eco 路径

- [ ] **Step 1:** `rg` 列出残留；删除死代码与过时测试
- [ ] **Step 2:** 跑  
  `cd packages/runtime && bun test`（相关）  
  `cd apps/desktop && bun test test/*acp* test/*workflow* test/sidebar* test/default-agent*`
- [ ] **Step 3:** 手动冒烟清单写入报告：  
  1) 默认无 Cursor·ACP  
  2) 探测通过可开  
  3) 开跑一条短 prompt  
  4) 取消  
  5) 续跑（若 loadSession 可用）或确认缺口文案  
- [ ] **Step 4:** 更新 spec 状态为「实现中/已实现」若需要  
- [ ] **Step 5: Commit**（仅当用户要求）

---

## Spec coverage checklist

| Spec 要求 | Task |
|-----------|------|
| ACP 宿主 + Cursor `agent acp` | 2–5 |
| `coreKind: acp` + `acpAgentId` | 1, 6, 8 |
| Label ACP | 8 |
| 废弃 stream-json | 5, 9 |
| Opt-in + 探测 | 7, 8 |
| AgentEvent 映射 | 4, 6 |
| 续跑/缺口诚实 | 3, 6 |
| 审批占位 | 1（capability） |
| 静默升级旧 cursor 线程 | 8 |
| 不双轨 | 5, 9 |

## Self-review notes

- 无 TBD 方法名：以本机探测为准；`session/load` 形状实现时用一次真实调用锁定。
- 与已提交「外置」plan **不要执行**；本 plan 取代之。
- 工作区未提交 WIP 必须在 Task 5–8 消化，避免两套 Cursor 并存。
