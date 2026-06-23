# 工具调用事件子代理归因闭环

目标：**所有子代理工具事件 100% 精准挂到对应 `agentId`，禁止 role 启发式 / sole-active 兜底；归因未就绪时事件保留等待，不丢弃、不降级到主时间线。**

## ID 契约

| 字段 | 含义 | 子代理内工具 | 主代理工具 |
|------|------|-------------|-----------|
| `tool_use_id` | 当前工具调用 id | 有 | 有 |
| `parent_tool_use_id` | 委派 `Agent`/`Task` 的 toolUseId | **必须有** | 无（正确） |
| `agentId` | Eco 子代理实例 id | 由 parent 解析 | 无 |

## 数据流

```
PreToolUse(Agent/Task)
  → SubagentLaunchRegistry.register(parentToolUseId)
  → noteTaskToolUse(parentToolUseId)          // pending，未 link

SubagentStart
  → onSubagentStart({ parentToolUseId, agentId })
  → link(parentToolUseId, agentId)            // 此后可 resolve

SDK 消息 (stream_event | assistant | tool_progress | tool_use_summary)
  → mapSdkMessageToEvents (+ parent_tool_use_id)
  → emitSdkStreamActivity
  → metadata.parent_tool_use_id
  → recordThreadRunEventFromLiveEvent
  → ThreadRunEvent { parentToolUseId, agentId?, scope }

buildThreadRunProjection
  → resolveProjectionEventAgentId
  → agents[].timeline（或 pending 等待 link）
```

## 为何会缺 `parent_tool_use_id`

| 原因 | 类型 | 处理 |
|------|------|------|
| 主代理 planner 工具 | 设计如此 | `scope=main`，不要求 parent |
| `mapTaskSystemMessageToEvents` 未传 attribution | **代码缺口** | 统一 `readSdkMessageAttribution` |
| `assistant` 内 `tool_use` 仅抄 envelope、无 ctx 回退 | **代码缺口** | 与 tool_progress 对齐 |
| 主会话 `stream_event` 冲掉 `streamCtx.parentToolUseId` 后，顶层 tool 消息无 parent | SDK + ctx | 依赖 SDK 在消息上带 parent；ctx 仅作补充 |
| 事件早于 `SubagentStart` 到达 | 时序 | **pending 等待 link**，不丢事件 |

## 为何会「无 ID」（无 agentId 且无有效 parent）

| 场景 | 处理策略 |
|------|----------|
| 主代理工具 | `scope=main` |
| 有 `parent_tool_use_id`，link 未完成 | `scope=agent` + **pending**，等 `agent.started` 后 replay |
| 子代理工具，SDK 未带 parent 且 ctx 已清 | diagnostic `missing_parent_tool_use_id`，不进主时间线 |
| 仅 sole-active 命中 | **删除该兜底** |

## 当前缺口（待修复）

- [x] `recordThreadRunEventFromLiveEvent`：删除 role-only `resolveAgentId` 兜底
- [x] `thread-run-event-normalizer`：子代理 `tool.*` 无 parent/agentId 时不落 `scope=main`
- [x] `mapTaskSystemMessageToEvents`：贯通 `parent_tool_use_id` / streamCtx
- [x] `mapAssistantMessageToEvents`：`tool_use` 使用 `readSdkMessageAttribution`
- [x] `buildThreadRunProjection`：`parentToolUseId` 已存在、agent 未就绪 → pending replay
- [x] Runtime 单测：`tool_progress` / `tool_use_summary` + parent → payload 断言
- [x] Desktop 单测：pending replay + 禁止 main 降级

## 进度日志

| 日期 | 内容 |
|------|------|
| 2026-06-23 | 初版：OTel 移除后 SDK-only 归因调查；明确四类根因与 pending 方案 |
| 2026-06-23 | 闭环实现：mapper 统一 attribution、删除 role 兜底、normalizer 禁止 main 降级、projection pending replay |
