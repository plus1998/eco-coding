# PI Agent 冒烟测试报告

> 配套测试文件：`packages/runtime/test/pi-agent-smoke.test.ts`
> 运行方式：`bun test packages/runtime/test/pi-agent-smoke.test.ts`
> 用途：回放测试 —— 修改 `runtime-activity-display.ts` / `pi-event-adapter.ts` / 桌面端投影逻辑后，重跑此对照表确认能力未退化。

## 对照总表（当前状态：全部 PASS）

| 功能类型 | 事件类型 | 活动流单行显示 | 内容/结果是否露出 | 判定 |
| --- | --- | --- | --- | --- |
| 文本流式输出 | `message.delta` (eco_stream text) | 流式文本块 | ✅ 有 | PASS |
| 思考流式输出 | `message.delta` (eco_stream thinking) | 流式思考块 | ✅ 有 | PASS |
| Bash 命令（开始） | `tool.started` | `Tool: bash · ls -la` | ✅ 命令可见 | PASS |
| 读文件（完成） | `tool.completed` | `Tool: read · a.ts · <内容摘要>` | ✅ 路径 + 内容预览 | PASS |
| 写/编辑文件（完成） | `tool.completed` | `Tool: write · b.ts · <结果>` | ✅ 路径 + 结果预览 | PASS |
| 搜索（grep/bash，完成） | `tool.completed` | `Tool: bash · grep … · <匹配>` | ✅ 命令 + 输出预览 | PASS |
| MCP 代理（完成） | `tool.completed` | `Tool: mcp · <结果>` | ✅ 结果预览 | PASS |
| Skill 调用（完成） | `tool.completed` | `Tool: dataviz · <结果>` | ✅ 结果预览 | PASS |
| 子代理 Agent（完成） | `tool.completed` | `Tool: Agent · <任务+结果>` | ✅ 任务与结果均可见 | PASS |
| finalize_plan（完成） | `tool.completed` | `Tool: finalize_plan · <计划>` | ✅ 计划文本预览 | PASS |
| 用量记录 | `usage.recorded` | （按设计无行） | — | PASS |
| 工具失败 | `tool.failed` | `Tool failed: read: EISDIR…` | ✅ 错误 + input 回放 | PASS |
| Agent 生命周期 | `agent.loop_ended` / `agent.settled` | （无行） | — | PASS |
| Bash 命令任务提示（开始） | `tool.started` Agent | `Tool: Agent · coder · 任务` | ✅ PI `agent`/`task` 字段 | PASS |

**汇总：FAIL=0  WARN=0  PASS=13**

## 已实施的适配

### 1. `pi-event-adapter.ts`

- `pendingToolUses` 在 `tool.started` 时缓存 input，`tool.completed` / `tool.failed` 回放 `input`（含 readTarget 解析所需 path）。
- Agent 工具 input 归一化：`agent` → 同时写入 `agent_type` / `subagent_type`。

### 2. `runtime-activity-display.ts`

- `tool_result` 分支同时读 `input` 与 `content`，单行显示路径/命令 + 内容摘要（≤80 字符）。
- Agent 任务提示识别 PI 字段名 `agent` + `task`。

### 3. `sdk-stream-activity.ts`（桌面端持久化 metadata）

- 所有工具的 `outputPreview`（不再仅限 Bash）。
- `tool.failed` 同样填充 `outputPreview`、`readTarget`、`grepTarget`。

### 4. 投影 / UI

- `shouldSuppressFilesystemToolPlaceholder` 与 `READ_TOOL_NAMES` 支持小写 `read`（PI 原生工具名）。
- 投影 action block 新增 `toolOutput`，read/grep/mcp 等工具可展开查看输出。

### 5. Mobile

- `activity_display.dart` 对所有工具读取 `outputPreview`（不再仅限 Bash）。

## 回归

```bash
bun test packages/runtime/test/pi-agent-smoke.test.ts
```

若 FAIL > 0，说明 PI 工具展示链路出现退化。
