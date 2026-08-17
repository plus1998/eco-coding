# Cursor ACP Plan / Ask 模式接入设计

日期：2026-08-17  
修订：2026-08-17（按 Cursor ACP 官方 + 社区做法校正，不再以 Claude/Pi 审批抽象为权威）  
状态：implemented（blocking create_plan + set_mode(agent) + 同 session plan continue；断线 fallback continuation）  
相关：`docs/superpowers/specs/2026-08-15-acp-host-cursor-design.md`

## 权威来源（必须优先于仓库旧模式）

1. **ACP 本体**（[session modes](https://agentclientprotocol.com/protocol/session-modes)）  
   - Plan 进度：`session/update` `plan`  
   - 通用退出 plan：常为 `session/request_permission` + `kind: switch_mode`  
2. **Cursor CLI ACP**（[cursor.com/docs/cli/acp](https://cursor.com/docs/cli/acp)）  
   - `cursor/create_plan`：**blocking** RPC；Agent 等到 Client 回包  
   - 响应形状：`{ outcome: { outcome: "accepted" | "rejected" | "cancelled", ... } }`（嵌套 outcome）  
3. **社区（HAPI #1097，2026-07）**  
   - 仅回 `accepted` 不够：同轮常「计划完成就停」、**不执行原任务**  
   - 正确 handoff：accept → 切出 plan → **同 session 再续一轮执行 prompt**  
   - 用户要的不是「做完计划就停」

## 问题

1. Eco 曾用 Claude bridge / Pi continuation 硬套 ACP，与 Cursor blocking 合同不一致。  
2. Composer 曾强制 ACP=`agent`；Debug 在 Cursor ACP 不存在。  
3. 批准后若 Cursor 结束 turn，无 continue → 会话看似「提交计划就停」。

## 真机依据（本机，2026-08-17）

CLI `2026.08.11-e8db854`：modes = agent/plan/ask；`cursor/create_plan` 阻塞；模型线 id 如 `default[]`。

## 目标

### Happy path（标准主路径）

1. Plan 跑：`set_mode(plan)` → `session/prompt`。  
2. Agent 发 `cursor/create_plan` → Eco **挂起该 JSON-RPC**（进程与 prompt 仍活着），UI 待批。  
3. 用户 **接受**：  
   - 回嵌套 `{ outcome: { outcome: "accepted" } }`  
   - `session/set_mode("agent")`  
   - Eco 线程 `sessionMode=agent`  
   - **同 ACP session**：首轮 prompt 返回后，若本轮刚接受过 plan，再发一轮 continue prompt（HAPI 语义）  
4. 用户 **拒绝**：回 `rejected`；保持 plan；不 continue。

### Fallback（仅断线 / 进程已死）

- create_plan 仍挂着但 child 已死：释放 bridge、**保留** pending plan → `awaiting_plan`。  
- 批准走 **continuation**（新 spawn + resume），并在事件里标明 fallback，不是主路径。

## 非目标

- 把 Codex/Pi「先结束再批」当成 Cursor 主路径。  
- Debug 模式。  
- 静默 auto-accept `create_plan`。

## 拍板

| 项 | 决定 |
|----|------|
| 审批合同 | Blocking `create_plan`，主路径不提前结束 run |
| Wire | 嵌套 `outcome.outcome`（与 Cursor 文档 / HAPI 一致） |
| Accept | `set_mode(agent)` + **plan→execute continue**（同 session） |
| Reject | `rejected`，留 plan |
| 断线 | 显式 fallback continuation |
| Ask | `cursor/ask_question` 必接，防挂死 |

## 明确缺口

- Cursor 是否在 accept 后同轮继续改代码：**不保证** → Eco 必须 continue handoff。  
- ACP 本体 `switch_mode` permission 与 Cursor `create_plan` 并存；Cursor Plan 以 `create_plan` 为准。  
- 断线 fallback 无法恢复原 RPC，只能新 turn。
