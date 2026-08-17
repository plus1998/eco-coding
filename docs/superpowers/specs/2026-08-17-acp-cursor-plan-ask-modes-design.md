# Cursor ACP Plan / Ask 模式接入设计

日期：2026-08-17  
状态：implemented（runtime + desktop 接线；单测已绿）  
相关：`docs/superpowers/specs/2026-08-15-acp-host-cursor-design.md`

## 问题

1. Eco Composer 对 ACP 强制 `sessionMode: "agent"`，Plan/Ask UI 被关掉。
2. Cursor ACP 真机支持 `agent` / `plan` / `ask`（经 `session/set_mode`），以及阻塞 RPC `cursor/create_plan`。
3. Eco `AcpClient` 未处理 `cursor/create_plan`，计划无法对接审批；`MODEL_GAP` 误导（模型可用 `session/set_model`）。
4. Debug 模式在 Cursor ACP **不存在**，不得假装支持。

## 真机依据（本机，2026-08-17）

CLI `2026.08.11-e8db854` + API key：

- `session/new.modes.availableModes`: agent / plan / ask
- `session/set_mode` / `session/set_config_option(mode=…)`：三者成功；`debug` 失败
- `session/set_model`：线 id 如 `default[]`、`composer-2.5[fast=true]`；短名 `auto` / `composer-2.5` → `-32602`
- `session/load` 结果含 `models.availableModels`（与 `session/new` 同形）；续跑必须解析后再 `set_model`
- Plan：`cursor/create_plan`（阻塞）+ `sessionUpdate: plan` + 读工具
- Ask：无写工具；message / thought chunks

## 目标（MVP）

1. Composer 对 Cursor ACP 可选 Plan / Ask / Agent。
2. 开跑前 `set_model`（若有）+ `set_mode`，再 `session/prompt`。
3. Plan：`cursor/create_plan` → Eco 计划审批桥 → accepted / rejected。
4. Ask：只读问答，不走计划审批。
5. Debug：unsupported。

## 非目标（MVP）

- Debug 模式映射。
- `cursor/task` / `cursor/generate_image` 产品化。
- Eco provider 替代 Cursor 模型。
- 改变「每轮 spawn ACP」生命周期。

## 拍板

1. 模式权威源：线程 `runtimeConfig.sessionMode`；每轮 prompt 前对齐。
2. 计划审批：`registerPendingPlanApproval` bridge（active run 内挂起 RPC）。
3. 批准：回 `accepted` + `session/set_mode("agent")` + 线程切 agent；不另起 execution run。
4. 拒绝：回 `rejected`；保持 plan。
5. `cursor/ask_question`：MVP 接 AskUserQuestion，防挂死。
6. 非法 model 线 id：明确失败，不静默忽略。

## 方案

见实现落点：`acp-types` / `acp-client` / `acp-agent-driver` / `acp-event-map` / `core-runtime` / `acp-session-mode` / `acp-runtime-run` / Main 审批桥。

## 明确缺口

- Debug：ACP 无。
- `cursor/ask_question`：文档有，短探针未触发；handler 必接。
- 批准后 Cursor 是否立刻改代码：不保证；Eco 只保证 mode=agent。
