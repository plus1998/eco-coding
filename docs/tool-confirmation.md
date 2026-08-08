# 执行确认（Tool Confirmation）

> Eco 对「要不要跑这条命令 / 读这个路径」的统一产品模型。  
> 实现入口：`packages/runtime/src/tool-confirmation.ts`

---

## 唯一用户入口：Composer

执行确认**只在 Composer 配置**（持久化字段仍为 `bashReviewMode`）。主代理 / 子代理能力页、orchestration 工具策略**不再提供**该开关。

Agent 工具策略只决定「能不能用工具」；「要不要确认」由会话的 Composer 档位决定。

新会话默认档位为 **`always`（请求批准 / 最低特权）**。  
遗留 `ToolPolicy.confirmation` 若仍出现在旧资源 JSON 中会被忽略，再保存时不再写出；不得绕过 Composer。

---

## 用户可见的三档

| 档位 | 含义 |
|------|------|
| **请求批准** (`always`) | 终端命令与工作区外读取都询问（默认） |
| **替我审批** (`auto`) | 低风险自动执行；高风险命令仍询问 |
| **完全访问** (`allow_all`) | 跳过确认（orchestration 禁用、Plan/Ask 模式、硬拒规则仍生效） |

---

## 一条决策链

```
orchestration / sessionMode：能不能用这工具？
        ↓ 不能 → 硬拒（无弹窗）
PreToolUse Hook：硬拒 denylist / 阶段禁用；工作区外文件访问返回 ask
        ↓ 通过
canUseTool（Desktop）：evaluateToolConfirmation（档位 = Composer bashReviewMode）
        ↓
  allow → 执行
  ask   → 统一确认 UI（BashApprovalPanel，也用于工作区外 Read/Glob/Grep/Write/Edit）
  deny  → 失败（无弹窗）
```

**Bash 的风险打分与用户确认只在 `canUseTool` 做一次**；Hook 不再对 Bash 发 `ask`，避免重复判断。

工作区外读写在 `acceptEdits` 下可能被 SDK 自动放行，因此 **外部文件访问仍在 Hook 层发 `ask`**（当确认档位不是 `allow_all` 时），与 Bash 的「仅 canUseTool 确认」略有不同——这是 SDK 管线约束，不是两套产品逻辑。

---

## Session 模式边界

| `sessionMode` | 执行确认 |
|---------------|----------|
| `agent` | 按三档执行 |
| `plan` / `ask` | 不允许 Bash；外读按 orchestration |

---

## 代码索引

| 职责 | 文件 |
|------|------|
| 统一决策 | `packages/runtime/src/tool-confirmation.ts` |
| Hook 硬拒 | `packages/runtime/src/eco-sdk-hooks.ts` |
| Desktop 确认 UI 桥 | `apps/desktop/src/main/index.ts` → `createThreadToolPermissionHandler` |
| Composer UI / 文案 | `apps/desktop/src/shared/bash-review-ui.ts` |
| 会话档位默认 | `apps/desktop/src/shared/thread-runtime-config.ts` |

---

## 相关文档

- [agent-sdk-tools-and-permissions.md](./agent-sdk-tools-and-permissions.md)
- [session-mode-simplification.md](./session-mode-simplification.md)
