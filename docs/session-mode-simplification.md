# Session 模式简化推进计划

> 目标：对齐 Claude Code / Agent SDK 的「用户显式选模式 + 权限/工具约束驱动行为」，去掉 prompt 分类、平行 runtime 路径和 system prompt 里的编排说教。
>
> 状态：**进行中**（Phase 0 文档对齐）

---

## 1. 背景与原则

### 1.1 Claude Code 泄露源码中的稳定模型

| 机制 | Claude Code | Eco 应对 |
|------|-------------|----------|
| 模式选择 | 用户通过 UI / CLI / settings 设 `permissionMode` | Composer 显式三档，**不**根据 prompt 正则分类 |
| Plan | `permissionMode: plan` + `EnterPlanMode` / `ExitPlanMode` | 已有 `planModeEnabled`，保持并纳入统一 enum |
| 只读 / 问答 | 无独立「Q&A 产品线」；Explore `whenToUse` 含 codebase Q&A；只读靠 **工具 + permission** | 新增用户选的 **Ask**，用工具白名单实现，**不**新建 prompt 树 |
| `dontAsk` | headless：本该 `ask` 的工具一律 **deny** | **不**把 `dontAsk` 当作 Ask 模式 |
| 子代理编排 | `BuiltInAgentDefinition`：`whenToUse` + `tools` / `disallowedTools` + 子代理 `getSystemPrompt` | 编排信息进 `agents` 定义与 hooks，**不**在 main system prompt 复述 |

参考（社区还原，非官方）：

- `EXTERNAL_PERMISSION_MODES`: `default` | `plan` | `acceptEdits` | `dontAsk` | `bypassPermissions`
- `src/tools/AgentTool/built-in/exploreAgent.ts` — Explore 只读 + `whenToUse`
- `src/tools/AgentTool/built-in/planAgent.ts` — Plan 只读 + `disallowedTools`

### 1.2 Eco 设计原则（本计划约束）

1. **一个 runtime 入口**：`run` / `runContinuation` 按 `sessionMode` 分支参数，不保留平行的 `runQuestion()` 产品线。
2. **行为由结构约束**：`permissionMode`、`allowedTools`、`disallowedTools`、`agents` 注册表、PreToolUse hooks。
3. **System prompt 只保留**：SDK preset（或用户 custom）、极简产品边界（工作区 / AGENTS.md）、profile 用户自定义 `mainAgent.prompt`。
4. **子代理路由**：`description` / `whenToUse` + 工具策略；deny hook 错误信息可指向「当前 session 注册的 agents」。
5. **渐进迁移**：每阶段可合并、可回滚；旧字段可短期兼容。

---

## 2. 现状问题（要消掉的）

### 2.1 隐式意图分类

- `apps/desktop/src/main/thread-intent.ts` — `classifyThreadIntent(prompt)`
- 影响：`threadStart`、续聊 `startThreadContinuation`、失败重试
- 问题：coding 线程中途问一句可能被切成 question 路径，工具和 system append 突变

### 2.2 平行 Q&A 路径

- `ClaudeAgentSdkDriver.runQuestion()` + `runQuestionThread()`
- `packages/runtime/src/prompts/question.ts` — `buildQuestionAnswerSystemAppend` / `buildQuestionAnswerPrompt`
- `permissionMode: dontAsk` 误用为「问答模式」

### 2.3 System prompt 分支过多

当前 main session append 层（coding）大致为：

```
claude_code preset
  + ecoBasePromptAppend
  + autonomousOrchestratorAppend（含 mandatory policy / available subagents）
  + buildMainAgentHandsOnBoundaryAppend
  + buildMainAgentProfileAppend（roster + strategy）
```

与 `options.agents`、`PreToolUse` hooks、profile tool policy **三重重复**。

### 2.4 已完成的局部优化（可在此基础上继续）

- `buildAutonomousOrchestratorAppend(availability, { hasProfileRoster })` 已去重 mandatory 规则、对齐 availability（`packages/runtime/src/prompts/autonomous.ts`）

---

## 3. 目标架构

### 3.1 Composer 三档（互斥）

| `sessionMode` | UI 标题 | SDK `permissionMode` | 写/Bash | 子代理 | 计划审批 |
|---------------|---------|----------------------|---------|--------|----------|
| `agent` | Agent | `acceptEdits` | 按 profile | 全量 enabled | 主代理自行 `ExitPlanMode`（可选） |
| `plan` | Plan | `plan` | 禁止 | 只读子集 + `Agent(Plan)` 可选 | **必须**走 ExitPlanMode 桥接 |
| `ask` | Ask | `plan` 或只读白名单 + 无写工具 | 禁止 | 仅 explore（+ profile 只读子代理） | 不进入 |

> **决策（已对齐）**：`agent` | `plan` | `ask` **互斥**，不做 Plan+Ask 叠加。

### 3.2 配置模型迁移

**现在**：`ThreadRuntimeConfig.planModeEnabled: boolean`

**目标**：

```ts
type SessionMode = "agent" | "plan" | "ask";

interface ThreadRuntimeConfig {
  // ...
  sessionMode: SessionMode;
  /** @deprecated 迁移期读取：planModeEnabled === true → sessionMode === 'plan' */
  planModeEnabled?: boolean;
}
```

迁移策略：读时 `sessionMode ?? (planModeEnabled ? "plan" : "agent")`；写时双写一至两个版本。

### 3.3 Runtime 统一入口

```ts
// packages/runtime — 概念 API
type RunPhase = "autonomous" | "planning" | "execution" | "ask";

// Desktop 映射
// sessionMode=agent  → run() / runContinuation(execution|planning 按 plan 状态)
// sessionMode=plan   → 首条及续聊 planning 路径
// sessionMode=ask    → runSingleSession({ permissionMode: "plan", allowedTools: askTools, agents: askAgents })
```

删除：`runQuestion()`、`classifyThreadIntent()`、`ThreadContinueAction.kind === "question"`。

### 3.4 瘦 system prompt（目标态）

| 保留 | 删除或下沉 |
|------|------------|
| `ecoBasePromptAppend`（工作区边界） | `buildQuestionAnswerSystemAppend` 整文件 |
| profile `mainAgent.prompt`（用户配置） | `autonomousOrchestratorAppend` 中 mandatory / available 列表（有 roster 时） |
| universal profile 极简 phase 行（可选） | `buildMainAgentHandsOnBoundaryAppend` → 尽量仅 profile 限制写权限时出现 |
| | `buildQuestionAnswerPrompt` 包装（用户消息原样传入） |

子代理 `description` / `prompt` 仍在 `createAutonomousAgentDefinitions` / profile templates。

---

## 4. 分阶段推进

每阶段：**交付物 → 主要改动 → 验收 → 风险**。

---

### Phase 0 — 对齐与基线（当前）

**交付物**

- 本文档
- 团队确认：`sessionMode` 三档互斥、`dontAsk` 不用于 Ask

**验收**

- [ ] Review 通过

---

### Phase 1 — 配置与 UI：显式 Ask 模式

**目标**：用户能选 Ask，但尚未删 intent / `runQuestion`（双轨并行，Ask 走新路径）。

**改动**

| 区域 | 文件（示例） |
|------|----------------|
| 类型 | `apps/desktop/src/shared/thread-runtime-config.ts` — 加 `sessionMode` |
| IPC / 持久化 | `apps/desktop/src/shared/ipc.ts`、`conversation-store` 序列化 |
| Desktop UI | `plan-mode-ui.ts` → `session-mode-ui.ts` 三档；`ComposerPlanModeToggle.tsx` 扩展 |
| Mobile | `plan_mode_ui.dart`、`thread_models.dart`、`composer_controls.dart` |
| 设置默认值 | `workflowSettings` / global plan 开关迁移 |

**运行时（最小）**

- `threadStart`：若 `sessionMode === "ask"` → 新函数 `runAskThread()`（内部可先调用现有 `runQuestion` 实现，减少 Phase 1 风险）
- **不再**对 `sessionMode === "ask"` 的消息调用 `classifyThreadIntent`

**验收**

- [x] Composer 三档可切换，状态写入 thread / composer runtime config
- [x] 新建线程选 Ask → `runAskThread`（内部 `runQuestion`）
- [x] 选 Ask 时即使用户写「实现某某功能」，仍走 Ask（不自动变 Agent）
- [x] Mobile / Desktop 行为一致（三档 UI + `sessionMode` 序列化）
- [x] 旧 `planModeEnabled: true` 的 thread 仍能打开并等价于 `plan`

**风险**

- SQLite 里历史 thread 无 `sessionMode` — 必须兼容读取

---

### Phase 2 — Runtime 统一：合并 `runQuestion` 进 `runSingleSession`

**目标**：一条 session 构建路径，按 `RunPhase` / `sessionMode` 设参数。

**改动**

| 区域 | 文件 |
|------|------|
| Runtime | `packages/runtime/src/claude-agent-sdk.ts` — `resolveSessionRunParams(sessionMode)` |
| | 删除或 deprecated `runQuestion`；`run()` 接受 `phase: "ask"` |
| Driver 接口 | `packages/runtime/src/index.ts` — `AgentRuntimeDriver` |
| Desktop | `runQuestionThread` → `runAskThread` 调统一 API |
| 测试 | `packages/runtime/test/claude-agent-sdk.test.ts` — ask 参数快照 |

**Ask 参数约定（草案）**

```ts
{
  permissionMode: "plan",
  allowedTools: ["Agent", "Read", "Glob", "Grep", "LS", "NotebookRead", "WebSearch", "WebFetch", "Skill", ...delegation],
  agents: createAskAgentDefinitions(...), // 仅 eco_explore + profile 只读
  phaseAppend: "", // 目标：空或一行 "Session mode: ask (read-only)."
  prompt: input.prompt, // 不包装 buildQuestionAnswerPrompt
}
```

**验收**

- [x] `runQuestion` 无外部调用（仅 deprecated 转发一层，或直接删除）
- [x] Ask / Agent / Plan 共用 `runSingleSession`，diff 仅在 params
- [x] 现有 question 相关测试改为 ask phase 测试并通过

---

### Phase 3 — 删除意图分类与续聊 question 分叉

**目标**：所有入口只看 `sessionMode` + plan 状态机，不看 prompt 正则。

**改动**

| 删除 / 收缩 | 文件 |
|-------------|------|
| 删除 | `apps/desktop/src/main/thread-intent.ts` |
| 删除 | `apps/desktop/test/thread-intent.test.ts` |
| 收缩 | `apps/desktop/src/shared/thread-continuation.ts` — 去掉 `intent`、`kind: "question"` |
| 收缩 | `apps/desktop/src/main/index.ts` — `threadStart` / `startThreadContinuation` / retry |
| 更新 | `apps/desktop/test/thread-continue-routing.test.ts` |

**续聊规则（草案）**

- `sessionMode === "ask"` → 始终 `runContinuation(..., phase: "ask")` 或等价
- `sessionMode === "plan"` → 现有 plan 路由
- `sessionMode === "agent"` → 现有 autonomous / execution 路由
- **不再**根据 follow-up 文案切换模式

**验收**

- [x] 代码库无 `classifyThreadIntent` 引用
- [x] 续聊测试覆盖：Ask 线程 follow-up 仍为 Ask
- [ ] README Thread modes 表更新（Phase 5 亦可）

---

### Phase 4 — System prompt 瘦身

**目标**：去掉可在 hooks / `agents` 表达的编排 prose。

**顺序建议**（由低风险到高风险）

1. **删除** `packages/runtime/src/prompts/question.ts` 及 exports（Phase 2 后应已无引用）
2. **收缩** `autonomousOrchestratorAppend`：仅保留 2–3 行产品约束（如「不强制 review 顺序」「不用 Workflow」）；删除 mandatory / available（已有 `hasProfileRoster` 分支）
3. **评估** `buildMainAgentHandsOnBoundaryAppend`：仅在 `resolveMainAgentHandsOnCapability` 限制写/Bash 时注入
4. **评估** `buildMainAgentProfileAppend`：roster 是否可由 `agents` schema 单独承担；若保留，只留 profile 名 + strategy，不重复 agent 列表
5. **Universal** `buildUniversalPhaseAppend`：合并进 sessionMode 单行说明

**验收**

- [x] `agent-orchestration.test.ts` / `claude-agent-sdk.test.ts` 更新快照
- [ ] `agent-preset-evals` / commercial quality gate 仍通过（无 child prompt 泄漏）
- [ ] 手工：Agent 模式仍能委派 eco_coder；误用 SDK Explore 仍被 hook deny

**风险**

- 过度删减可能导致委派率下降 — 用 eval 或固定 thread 回归对比

---

### Phase 5 — 子代理与 SDK 内置对齐（可选深化）

**目标**：减少「屏蔽 SDK Explore → prompt 里教 eco_*」的结构性矛盾。

**选项 A（保守）**：维持 `eco_*`，但 **zero** main-prompt 提及；deny hook 消息改为「Use agents registered for this session」。

**选项 B（激进）**：部分场景允许 SDK `Explore` / `Plan`，Eco profile 子代理与之并存，靠 `permissions.deny` 控制。

**验收**

- [ ] 文档 `docs/agent-sdk-tools-and-permissions.md` 与实现一致
- [ ] `eco-sdk-hooks.test.ts` 覆盖 deny 文案

---

### Phase 6 — 文档与清理

- 更新 `README.md` Thread modes / Prompt architecture
- 删除 deprecated：`planModeEnabled` 双写（major 版本或 migration script）
- CHANGELOG 条目

---

## 5. 文件索引（按层）

### Desktop Main

- `apps/desktop/src/main/index.ts` — threadStart、续聊、retry、runQuestionThread
- `apps/desktop/src/main/thread-intent.ts` — **已删**
- `apps/desktop/src/main/thread-run-outcome.ts` — question outcome → ask outcome

### Desktop Shared

- `apps/desktop/src/shared/thread-continuation.ts`
- `apps/desktop/src/shared/thread-runtime-config.ts`
- `apps/desktop/src/shared/plan-mode-ui.ts` — **待扩为 session-mode-ui**

### Runtime

- `packages/runtime/src/claude-agent-sdk.ts`
- `packages/runtime/src/prompts/autonomous.ts`
- `packages/runtime/src/prompts/question.ts` — **已删**
- `packages/runtime/src/prompts/subagent-pipeline.ts`
- `packages/runtime/src/agent-orchestration.ts` — `buildMainAgentSystemPrompt`
- `packages/runtime/src/eco-sdk-hooks.ts`

### Mobile

- `apps/mobile/lib/core/constants/plan_mode_ui.dart`
- `apps/mobile/lib/core/models/thread_models.dart`
- `apps/mobile/lib/features/composer/composer_controls.dart`

---

## 6. 测试清单

| 场景 | 期望 |
|------|------|
| 新建 Agent 线程 | `acceptEdits`，可 Write/Bash |
| 新建 Plan 线程 | `plan`，ExitPlanMode → awaiting_plan |
| 新建 Ask 线程 | 只读，无 Write/Bash，可 Read / explore |
| Ask 后续「帮我改代码」 | 仍为 Ask（除非用户切 Composer 模式） |
| Agent 后续纯提问 | 仍为 Agent |
| 历史 `planModeEnabled: true` thread | 等价 Plan |
| Profile 禁用 reviewer | Ask/Agent 均不可 Agent(reviewer) |
| hook deny SDK Explore | 无 mandatory prompt 时仍 deny |

---

## 7. 开放问题

| # | 问题 | 建议 |
|---|------|------|
| 1 | Ask 是否允许 `AskUserQuestion`？ | 允许（澄清问题）；与 Plan 一致 |
| 2 | Ask 是否允许 profile 自定义只读子代理？ | 允许 WebSearch 类；禁止 coder/reviewer |
| 3 | Thread 创建后能否改 `sessionMode`？ | Composer 可改「下一条」模式；已跑 session 不强制改历史 |
| 4 | `sessionMode` 存在 thread 还是仅 composer？ | **thread 持久化**（与 planMode 一致），composer 为默认 |

---

## 8. 推进记录

| 日期 | Phase | 说明 |
|------|-------|------|
| 2026-06-25 | 0 | 创建本文档；对齐 Claude Code 模式模型 |
| 2026-06-25 | 1 | Composer 三档 `sessionMode`（agent/plan/ask）；Ask 走 `runAskThread`；续聊按 thread sessionMode 路由 |

---

## 9. 相关文档

- [agent-sdk-tools-and-permissions.md](./agent-sdk-tools-and-permissions.md) — SDK 两层工具模型、Plan 两段式
- [README.md](../README.md) — 当前 Thread modes（Phase 6 更新）
