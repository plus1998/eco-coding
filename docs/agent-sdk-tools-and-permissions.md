# Claude Agent SDK：工具可见性与权限

本文档记录 Eco 集成 Claude Agent SDK 时的工具模型、常见踩坑，以及 Eco 自己的映射方式。目的是避免把「工具可见」「自动批准」「Profile 禁止」混为一谈。

官方入口：

- [Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview)
- [Configure permissions](https://code.claude.com/docs/en/agent-sdk/permissions)
- [Custom tools (availability vs permission)](https://code.claude.com/docs/en/agent-sdk/custom-tools)
- [Handle approvals and user input](https://code.claude.com/docs/en/agent-sdk/user-input)

相关 GitHub issue（别人踩过的坑）：

- [anthropics/claude-code#17577](https://github.com/anthropics/claude-code/issues/17577) — CLI 与 SDK 对 `allowedTools` 语义不一致
- [anthropics/claude-code#20242](https://github.com/anthropics/claude-code/issues/20242) — `tools` vs `allowedTools` 文档澄清
- [anthropics/claude-agent-sdk-python#774](https://github.com/anthropics/claude-agent-sdk-python/issues/774) — `ExitPlanMode` 会终止当前 turn
- [anthropics/claude-code#40671](https://github.com/anthropics/claude-code/issues/40671) — Plan 结束后不能在同一 turn 继续执行

---

## 核心原则

### SDK 侧：两层模型

| 层级 | 回答的问题 | 主要 API |
|------|------------|----------|
| **可用性（Availability）** | Claude **能不能看到/尝试**这个工具 | `tools`、`disallowedTools`（裸工具名） |
| **权限（Permission）** | 调用时要不要弹窗 / 走回调 | `allowedTools`、`permissionMode`、`canUseTool` |

官方 permissions 文档中的评估顺序（简化）：

```
Hooks → deny rules → ask rules → permissionMode → allow rules → canUseTool
```

### Eco 侧：一条产品原则

**未显式禁止 = 允许。**

Eco Profile 的工具策略只应通过显式规则表达：

- `disallowed` 列表（裸工具名 = 禁止）
- 明确的结构化开关（例如 `bash.enabled: false`、`filesystem.write: "none"`）

不要在 Eco 里再做「结构性推断」（例如「没有写权限就推断 Bash 也禁用」）。这与 SDK 两层模型冲突，也会导致 UI 显示与运行时行为不一致。

---

## 1. 怎么携带 / 不携带内置工具

我们不知道 Claude Code preset 里未来会有多少内置工具，也不需要枚举全部。控制方式只有三种：

### A. 默认全开（Eco 主路径）

```typescript
tools: { type: "preset", preset: "claude_code" }
```

所有 Claude Code 内置工具进入模型上下文，除非后续显式拿掉。

实现位置：`packages/runtime/src/claude-agent-sdk.ts` → `runSingleSession()`。

### B. 白名单（只给这些）

```typescript
tools: ["Read", "Glob", "Grep"]
```

只有列出的内置工具可见。MCP 工具不受 `tools` 数组影响。

### C. 从上下文中移除（推荐用于「禁止」）

```typescript
disallowedTools: ["Bash", "Write", "Edit"]
```

**裸工具名**（如 `"Bash"`）会把工具从模型上下文里拿掉，Claude 不会尝试调用。

**带 pattern 的规则**（如 `"Bash(rm *)"`）工具仍可见，只拒绝匹配的调用（属于 permission 层）。

| 写法 | 层级 | 效果 |
|------|------|------|
| `tools: ["Read", "Grep"]` | 可用性 | 只有这些内置工具可见 |
| `disallowedTools: ["Bash"]` | 可用性 | Bash 从上下文移除 |
| `disallowedTools: ["Bash(rm *)"]` | 权限 | Bash 仍可见，匹配命令被拒绝 |

### Eco Plan 阶段现状

Plan 阶段当前配置：

- `permissionMode: "plan"`
- `allowedTools`: Read / Glob / Grep / WebSearch / WebFetch / Agent / AskUserQuestion 等
- `disallowedTools`: 写工具（Write / Edit / MultiEdit / NotebookEdit）+ **Bash**

Bash 与写工具通过 SDK `disallowedTools` 从模型上下文移除；读工具（Read / Grep / Glob）保持可见。Eco PreToolUse hook 与 Profile `disallowed`（经物化）作为第二层执行校验。

---

## 2. 「开启工具」≠「自动同意工具」

这是最多人踩的坑。官方 overview 的部分示例仍写 `allowedTools: ["Read", "Glob", "Grep"]` 表示只读 agent，容易误导——在 SDK 里，`allowedTools` 主要是 **auto-approve 列表**，不是可见性白名单。

### 正确理解

| 你以为 | 实际 |
|--------|------|
| `allowedTools` 里有 Bash = **开启** Bash | ❌ 只是**自动批准**；preset 下 Bash 默认可见 |
| `bashReviewMode: allow_all` = **开启** Bash | ❌ 只是**跳过 Bash 审批**；Profile / disallow 仍可禁用 |
| `permissionMode: bypassPermissions` + 少量 `allowedTools` | ❌ 仍会批准**所有**到达 permission 步骤的工具 |
| `permissionMode: dontAsk` + `allowedTools` | ✅ 列表内自动批准，其余**直接拒绝**（不弹窗） |

### `permissionMode` 速查

| Mode | 行为 |
|------|------|
| `default` | 无自动批准；未匹配的工具走 `canUseTool` |
| `dontAsk` | 未预批准的直接拒绝，不调用 `canUseTool` |
| `acceptEdits` | 自动批准文件编辑和文件系统操作 |
| `bypassPermissions` | 自动批准（deny rules 和 hooks 仍可拦截） |
| `plan` | 只读探索；写操作和 shell 写操作不走 auto-approve，必须走 `canUseTool` |

### Eco 的三层叠加

Eco 在 SDK 之上还有自己的产品层：

```
SDK disallowedTools     → 从模型上下文移除（可用性）
SDK allowedTools        → 自动批准列表（权限）
SDK permissionMode      → 全局审批策略
SDK canUseTool          → Desktop 运行时审批（含 Bash 面板）
Eco PreToolUse hook     → Profile 工具策略（disallowed / filesystem / network / bash）
```

**执行确认**（Composer 三档：每次确认 / 风险时确认 / 自动执行）在 `canUseTool` 统一生效，**不等于**给 Agent 开启 Bash。

执行阶段若配置了 `toolPermissionHandler`，Eco 会 `stripBashAutoApprovedTools()`，确保 Bash 走执行确认流。

详见 [tool-confirmation.md](./tool-confirmation.md)。

只读 Ask 阶段使用 `permissionMode: "dontAsk"` + 只读 `allowedTools`，并在 SDK `disallowedTools` 中显式禁用写/Bash/`EnterPlanMode`/`ExitPlanMode`。Eco 不进入 ExitPlanMode 审批流程。

代码见 `buildAskSessionPhase()`（`packages/runtime/src/claude-agent-sdk.ts`）。

代码注释（权威简述）见 `packages/runtime/src/eco-sdk-hooks.ts` 中 `createExitPlanModePreToolHook` 上方的 block comment。

---

## 3. Plan 模式用法

### SDK 官方语义

```typescript
permissionMode: "plan"
```

- Read / Glob / Grep 等**只读工具**应正常可用
- 写工具不应被 auto-approve；即使出现在 `allowedTools` 里也需走 `canUseTool`
- 可用 `AskUserQuestion` 澄清需求
- 通过 `ExitPlanMode` 提交计划

### Eco 两段式

Eco 不把 Plan 和 Execute 塞在同一 SDK turn 里：

| 阶段 | permissionMode | 典型 allowedTools | SDK disallowedTools |
|------|----------------|-------------------|---------------------|
| Plan | `plan` | Read, Glob, Grep, WebSearch, Agent, AskUserQuestion… | 写工具 + Bash |
| Execute | `acceptEdits` | 含 Bash, Write, Edit… | — |

Plan 结束后用户批准，Eco 发起**新的 execution query**（可 resume 同一 SDK session）。这是正确做法，不是 workaround。

### `ExitPlanMode` 坑

**`ExitPlanMode` 会终止当前 SDK turn。** 不能在同一个 `query()` 里 Plan 完立刻 Bash / Write / 派子代理。

```
EnterPlanMode → Read → AskUserQuestion → ExitPlanMode → Bash   ❌ Bash 不会执行
Plan turn 结束 → 新开 execution turn → Bash                    ✅
```

Eco 通过 `createExitPlanModeAwaitApprovalHook` 在 PermissionRequest 中阻塞，待用户在 Eco / Mobile UI 批准后 `allow`；plan turn 结束后发起 **execution query**（可 resume 同一 SDK session），并在流建立后调用 `setPermissionMode("acceptEdits")`。这是正确做法，不是 workaround。

### Plan 阶段 Bash vs 读工具

- **Bash 应禁止**：Plan 是只读探索 + 出方案，不应跑 shell
- **Grep / Glob / Read 必须保留**：代码探索靠这些工具，不靠 `grep` / `find` 等 Bash 命令

若 Agent 在 Plan 里反复试 Bash，优先检查：

1. Bash 是否在 SDK `disallowedTools` 或 Eco Profile `disallowed` 里
2. 是否误把「Bash 完全访问」审批模式当成了「开启 Bash」

---

## 4. Eco 工具权限模块（`tool-permission-policy.ts`）

统一入口：`packages/runtime/src/tool-permission-policy.ts`

```
Profile 结构化开关 (bash / filesystem / network)
        ↓ materializeEcoToolPolicy()
   disallowed 裸工具名列表（唯一执行真相）
        ↓ capEcoToolPolicyForPhase()   （阶段 cap）
   运行时 EcoToolPolicy
        ├→ mergeSdkDisallowedTools() → SDK disallowedTools（可用性）
        └→ PreToolUse hook（物化后再检查 disallowed + bash 命令策略 + 路径 scope）
```

| 函数 | 作用 |
|------|------|
| `materializeEcoToolPolicy()` | 把 `bash.enabled: false`、`filesystem.read/write: "none"`、`network.*: false` **物化**进 `disallowed` |
| `isToolDisallowed()` | 判断某工具是否在物化后的 `disallowed` 中 |
| `capEcoToolPolicyForPhase()` | 阶段不允许的工具并入 `disallowed`（不隐式改 `bash.enabled`） |
| `mergeSdkDisallowedTools()` | 合并 Profile + 阶段 denylist，传给 SDK |
| `resolveMainAgentHandsOnFromPolicy()` | 从物化后的 `disallowed` 推导 `canEditFiles` / `canRunBash` |

**产品原则**：禁止只通过 `disallowed`（及物化）表达；hook 不再对 `filesystem.write: "none"` 单独拒绝写工具（已由物化处理），但仍保留**路径 scope**（工作区外读写）和 **bash 命令 allowlist/denylist** 检查。

---

## 5. Eco Profile 工具策略映射

Profile 表单的「工具能力」最终翻译为 `EcoToolPolicy`：

| UI / 能力 | 存储方式 |
|-----------|----------|
| 关闭某类工具 | 加入 `disallowed`（裸工具名） |
| 允许 Bash | 不设 `bash.enabled: false`，且 `disallowed` 不含 `Bash` |
| 禁止写文件 | `filesystem.write: "none"` 和/或 `disallowed` 含写工具名 |
| Plan 阶段额外限制 | `capEcoToolPolicyForPhase()` 把阶段不允许的工具并入 `disallowed` |

`resolveEffectiveBashPolicy()` 规则（`packages/runtime/src/agent-orchestration.ts`）：

- 物化后 `disallowed` 含 `Bash` → 禁用
- `bash.enabled === false` → 禁用（物化时也会加入 `disallowed`）
- 否则 → 启用

**不要**再根据 `filesystem.write` 推断 Bash 是否可用。

阶段 cap：`capEcoToolPolicyForPhase()` 在 `tool-permission-policy.ts` 中实现。

---

## 6. Skills 与外部读取边界

Skill 可加载性和 Agent 文件读取权限是两件事：

- 项目级 SDK-ready skills（`.claude/skills`，或 `.agents/skills` 已链接到 `.claude/skills`）默认注入 session。
- 用户级 skills 只在 prompt 中显式 `$skill-name` 引用时注入；仅本次显式引用到的用户 skill 目录会进入隐式读白名单。
- Eco 不把整个 `~/.claude/skills` / `~/.agents/skills` 作为默认读白名单。
- Agent 用 `Read` / `Glob` / `Grep` 读取工作区外代码或非显式 skill 目录时，必须走手动确认。

对 `.agents/skills` 的兼容方式：Eco 可以在同一 baseDir 下创建 `.claude/skills/<name> -> ../../.agents/skills/<name>` 的符号链接；发现阶段会把这种 skill 标记为 SDK-ready。运行时读白名单使用发现到的具体 skill 目录，而不是扩大到整个父目录。

---

## 7. 调试清单

遇到「工具被拒绝」时，按顺序排查：

1. **SDK 可用性**：工具是否在 `disallowedTools`（裸名）里？Plan 阶段写工具应在此列。
2. **SDK 权限**：是否在 `allowedTools` 里（仅影响 auto-approve）？`permissionMode` 是什么？
3. **canUseTool**：Desktop Bash 审批 / `bashReviewMode` 是否拒绝？
4. **Eco PreToolUse**：Profile `disallowed`、filesystem、network、bash 策略是否拒绝？
5. **阶段**：当前是 `planning` / `ask` / `execution`？Plan 与 Ask 阶段 Bash 应在 SDK `disallowedTools` 与物化后的 Profile `disallowed` 中。

错误信息对照：

| 消息 | 通常来源 |
|------|----------|
| `Tool "Bash" is disallowed for main.` | Eco Profile 物化后的 `disallowed`（显式禁止，符合预期） |
| `Tool "Write" is disallowed for main.` | `filesystem.write: "none"` 物化进 `disallowed` |
| `Permission denied for Bash: …` | SDK 汇总拒绝（上游为 hook 或 canUseTool） |

---

## 8. 实现索引

| 主题 | 文件 |
|------|------|
| **工具权限统一模块**（物化、阶段 cap、SDK deny 合并） | `packages/runtime/src/tool-permission-policy.ts` |
| SDK 内置工具名全集 | `packages/runtime/src/sdk-tool-names.ts` |
| SDK query 选项（phase、allowedTools、disallowedTools） | `packages/runtime/src/claude-agent-sdk.ts` |
| ExitPlanMode / 两层模型注释 | `packages/runtime/src/eco-sdk-hooks.ts` |
| Profile → SDK policy | `packages/runtime/src/agent-orchestration.ts` |
| Desktop 执行确认 | `apps/desktop/src/main/index.ts` → `createThreadToolPermissionHandler` |
| 确认决策 | `packages/runtime/src/tool-confirmation.ts` |
| Composer 执行确认 UI | `apps/desktop/src/shared/bash-review-ui.ts` |
| 执行确认产品说明 | `docs/tool-confirmation.md` |
| Profile 工具能力表单 | `apps/desktop/src/renderer/tool-capability-groups.ts` |
| Skills 注入和隐式读根 | `apps/desktop/src/shared/skills.ts` |

---

## 9. Session 模式与 `Agent()` 委派

Eco Composer 三档模式由用户显式选择（`sessionMode: agent | plan | ask`），**不再**根据用户消息正则推断 Q&A。

| `sessionMode` | SDK `permissionMode` | 典型入口 |
|---------------|----------------------|----------|
| **agent** | `acceptEdits` | `driver.run()` / execution continuation |
| **plan** | `plan` | `driver.runPlan()` / `runContinuation("planning")` |
| **ask** | `dontAsk`（只读工具集；禁用 Plan 工具） | `driver.runAsk()` / `runContinuation("ask")` |

Agent 模式保留 `AskUserQuestion`，但 `EnterPlanMode` / `ExitPlanMode` 在 SDK deny、PreToolUse 和 `canUseTool` 三层均被拒绝。Plan 模式的 `ExitPlanMode` 只能进入 Eco 审批桥；兼容 deferred resume 时仅允许原始已批准 `toolUseId` 完成一次。

### Eco 子代理 vs SDK 内置

- Eco 在 `agents` 中注册 `eco_*` 子代理（及 profile 动态 agent）；路由靠各 agent 的 `description`，**不在** main system prompt 里重复 mandatory roster。
- SDK 内置 `Explore` / `Plan` / `Bash` 等通过两层机制屏蔽：
  1. **SDK `permissions.deny`** — `Agent(Explore)` 等 pattern（`sdkBuiltinSubagentDenyRules`）
  2. **PreToolUse** — `createNonEcoSubagentDenyPreToolHook` 拒绝未注册的 `subagent_type`；拒绝文案指向 **「Use agents registered for this session」**，不引用 system prompt 里的 agent 列表。

Plan 阶段可临时允许 `Agent(Plan)`（`allowedSdkBuiltinAgentKeys`）；`general-purpose` 始终允许。

实现：`packages/runtime/src/eco-sdk-hooks.ts` → `createNonEcoSubagentDenyPreToolHook`。

---

## 10. 变更时注意

1. 改工具行为前，先分清是 **可用性** 还是 **权限** 问题。
2. 新增阶段限制时，优先往 `disallowed` 加裸工具名，不要加隐式推断。
3. 文档和注释里写 `allowedTools` 时，注明是 **auto-approve**，不是 **tool registry**。
4. Plan / Execute 必须保持**两个 turn**；不要假设 `ExitPlanMode` 后还能在同 turn 执行。
5. 单测里区分：`disallowed` 含工具名 vs `bash.enabled: false` vs `permissionMode`。
6. 外部读路径判断必须基于结构化路径解析，不要依赖错误文案字符串。
