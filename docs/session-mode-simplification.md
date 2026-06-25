# Session 模式简化推进计划

> 目标：对齐 Claude Code / Agent SDK 的「用户显式选模式 + 权限/工具约束驱动行为」，去掉 prompt 分类、平行 runtime 路径和 system prompt 里的编排说教。
>
> 状态：**已完成**（2026-06-25）

---

## 1. 背景与原则

### 1.1 Claude Code 泄露源码中的稳定模型

| 机制 | Claude Code | Eco 应对 |
|------|-------------|----------|
| 模式选择 | 用户通过 UI / CLI / settings 设 `permissionMode` | Composer 显式三档 `sessionMode`，**不**根据 prompt 正则分类 |
| Plan | `permissionMode: plan` + `EnterPlanMode` / `ExitPlanMode` | `sessionMode: plan` + SDK Plan Mode + Eco 审批桥 |
| 只读 / 问答 | 无独立「Q&A 产品线」；Explore `whenToUse` 含 codebase Q&A | 用户选的 **Ask**；`permissionMode: plan` + 只读工具白名单 + `AskUserQuestion` |
| `dontAsk` | headless：本该 `ask` 的工具一律 **deny** | **不**把 `dontAsk` 当作 Ask 模式 |
| 子代理编排 | `BuiltInAgentDefinition`：`whenToUse` + `tools` / `disallowedTools` | 编排信息进 `agents` 定义与 hooks，**不在** main system prompt 复述 |

### 1.2 Eco 设计原则

1. **一个 runtime 入口**：`run` / `runAsk` / `runContinuation` 共用 `runSingleSession`，按 `sessionMode` 设参数。
2. **行为由结构约束**：`permissionMode`、`allowedTools`、`disallowedTools`、`agents` 注册表、PreToolUse hooks。
3. **System prompt 只保留**：SDK preset、极简产品边界、profile `mainAgent.prompt`。
4. **子代理路由**：`description` / `whenToUse` + 工具策略；deny hook 指向当前 session 注册的 agents。
5. **破坏性迁移可接受**：仅 `sessionMode`；旧 `planModeEnabled` / `orchestrationMode` / run phase `"question"` 不再读取（SQLite 读路径对 `"question"` 做 `ask` 归一化）。

---

## 2. 目标架构（已实现）

### 2.1 Composer 三档（互斥）

| `sessionMode` | UI | SDK `permissionMode` | 写/Bash | 子代理 | 计划审批 |
|---------------|-----|----------------------|---------|--------|----------|
| `agent` | Agent | `acceptEdits` | 按 profile | 全量 enabled | 主代理可自行 `ExitPlanMode` |
| `plan` | Plan | `plan` | 禁止 | 只读子集 + `Agent(Plan)` 可选 | **必须** ExitPlanMode 桥接 |
| `ask` | Ask | `dontAsk` + 只读 `allowedTools` + 显式禁用写/Bash/Plan 工具 | 禁止 | 仅 `explore` | 不进入 |

### 2.2 配置模型

```ts
type SessionMode = "agent" | "plan" | "ask";

interface ThreadRuntimeConfig {
  sessionMode: SessionMode;
  // ...
}
```

`WorkflowSettingsSnapshot` 同样仅 `sessionMode`（workflow 默认）。

### 2.3 Runtime 映射

| `sessionMode` | 入口 |
|---------------|------|
| `agent` | `driver.run()` / `runContinuation("execution" \| "planning")` |
| `plan` | `driver.runPlan()` / `runContinuation("planning")` |
| `ask` | `driver.runAsk()` / `runContinuation("ask")` |

已删除：`classifyThreadIntent`、`question.ts`、`runQuestion`（外部）、`ThreadContinueAction.kind === "question"`。

---

## 3. 分阶段记录

| Phase | 内容 | 状态 |
|-------|------|------|
| 0 | 文档与 Claude 模型对齐 | ✅ |
| 1 | Composer 三档 UI + `runAskThread` | ✅ |
| 2 | `runAsk` 统一 `runSingleSession` | ✅ |
| 3 | 删除意图分类；续聊只看 `sessionMode` | ✅ |
| 4 | 删 `question.ts`；瘦 system prompt | ✅ |
| 5 | deny hook 文案；agent-sdk-tools 文档 | ✅ |
| 6 | README；删 `planModeEnabled`；收尾清理 | ✅ |

### Phase 6 收尾（Claude 对齐清单）

- [x] Ask 禁止 `AskUserQuestion` 与 Plan 工具（对齐 Cursor 只读问答）
- [x] `agent-preset-evals` 与 catalog 同步
- [x] Mobile 设置页三档 workflow 默认
- [x] 删除 `runQuestion`、死代码 `composer_mode_bar.dart`
- [x] run phase / subagent phase：`question` → `ask`（读库归一化）
- [x] `withAgentSessionMode` 替代 `withPlanModeDisabled`（后者 deprecated 转发）

---

## 4. 破坏性变更说明

| 旧数据 / 字段 | 行为 |
|---------------|------|
| `planModeEnabled` only | 无法解析 `runtimeConfig` → 按 workflow 默认重建（通常 agent） |
| `orchestrationMode` only | 同上 |
| run attempt phase `"question"` | 读库时归一化为 `"ask"` |
| follow-up `queued_during_phase: "question"` | 读库时归一化为 `"ask"` |

---

## 5. 文件索引

### Desktop

- `apps/desktop/src/main/index.ts` — threadStart、续聊、`runAskThread`
- `apps/desktop/src/shared/thread-continuation.ts`
- `apps/desktop/src/shared/thread-runtime-config.ts` — `sessionMode`、`withAgentSessionMode`
- `apps/desktop/src/shared/session-mode-ui.ts`
- `apps/desktop/src/renderer/ComposerPlanModeToggle.tsx` — 三档 UI（文件名待重命名，可选）

### Runtime

- `packages/runtime/src/claude-agent-sdk.ts` — `runAsk`、`buildAskSessionPhase`
- `packages/runtime/src/prompts/autonomous.ts`
- `packages/runtime/src/eco-sdk-hooks.ts`

### Mobile

- `apps/mobile/lib/core/constants/session_mode_ui.dart`
- `apps/mobile/lib/features/composer/composer_controls.dart`
- `apps/mobile/lib/features/settings/settings_screen.dart` — workflow 默认三档

### 已删除

- `thread-intent.ts`、`question.ts`、`plan_mode_ui.dart`、`composer_mode_bar.dart`

---

## 6. 测试清单

| 场景 | 期望 |
|------|------|
| 新建 Agent / Plan / Ask | 对应 `permissionMode` 与工具集 |
| Ask 后续「帮我改代码」 | 仍为 Ask |
| Agent 后续纯提问 | 仍为 Agent |
| Ask 可 `AskUserQuestion` | allowedTools 不含该工具 |
| Profile 禁用 reviewer | hooks + agents 注册表拦截 |
| hook deny SDK Explore | 无 mandatory prompt 仍 deny |

---

## 7. 开放问题（已关闭）

| # | 问题 | 决议 |
|---|------|------|
| 1 | Ask 是否允许 `AskUserQuestion`？ | **不允许**（Ask 只读问答；澄清留给 Plan） |
| 2 | Ask 是否允许 profile 只读子代理？ | 允许 |
| 3 | Thread 创建后能否改 `sessionMode`？ | Composer 可改下一条 |
| 4 | `sessionMode` 存哪？ | thread 持久化 + workflow 默认 |

---

## 8. 推进记录

| 日期 | 说明 |
|------|------|
| 2026-06-25 | Phase 0–6 完成；Claude 对齐收尾（AskUserQuestion、evals、Mobile 设置、命名清理） |

---

## 9. 相关文档

- [agent-sdk-tools-and-permissions.md](./agent-sdk-tools-and-permissions.md)
- [README.md](../README.md)
