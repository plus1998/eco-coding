# 零兜底归因推进计划

目标：**所有输出（任务目标、审批、请求、计费）100% 靠结构化 ID 归因，禁止 role 顺序 / 文本正则 / 启发式猜测。**

## 现状：双轨数据

| 轨道 | 载体 | 归因质量 |
|------|------|---------|
| 新轨 | `ThreadRunEvent` / `ThreadRunProjectionSnapshot` | 设计上可达 100% |
| 旧轨 | `ThreadActivityLine` 纯文本 | 只能靠兜底，**逐步废弃** |

新 UI（PC projection、移动端 projection enrich）必须只读新轨；旧轨仅只读回放，不再新增兜底逻辑。

## 归因 ID 契约

| ID | 作用 | 必须出现的位置 |
|----|------|---------------|
| `agentId` | 子代理实例唯一键 | `agent.started`、`agent.*` 事件、子代理工作行 |
| `parentToolUseId` | 委派工具调用 → 子代理实例 | `AgentInstance.parentToolUseId`、`agent.started` metadata |
| `toolUseId` | 工具/审批唯一键 | `metadata.tool.toolUseId`、`bashApproval.toolUseId` |
| `requestId` | 模型请求唯一键 | `request.*` 事件、proxy `x-request-id` 贯通 |

## 根因链（当前断点）

```
PreToolUse(Agent) ──parentToolUseId──► SubagentLaunchRegistry
        │                              │
        │ mission/prompt/todoId           │ keyed by parentToolUseId
        ▼                              ▼
   registry.register            SubagentStart(toolUseID=parent)
        │                              │
        └──────────► onStart({ parentToolUseId, prompt, todoId })
                           │
                    delegation + parentToolUseId（✓ 若上链正确）
```

## 阶段划分

### Phase 1 — toolUseId ↔ agentId 确定性绑定（P0）【已完成】

- [x] `SubagentLaunchRegistry`：PreToolUse 按 `parentToolUseId` 注册 launch
- [x] `createSubagentStartHook`：从 SDK hook 回调 `toolUseID` 解析 `parentToolUseId` 并贯通到 `onStart`
- [x] Desktop 废除 `pendingLaunches` role FIFO 消费
- [x] `SubagentStart` 用 explicit `parentToolUseId` 调用 `link()`，废除 role FIFO 消费
- [x] `agent-lifecycle-service.startSubagent` 接受 explicit `parentToolUseId`
- [x] `subagent-metrics-registry.onSubagentStart` 优先 explicit link

### Phase 2 — Mission 发射带 ID（P0）【已完成】

- [x] 展示层只读 delegation + parentToolUseId 链
- [x] 删除 `buildSubagentMissionTextByAgentId` 及 activity lines mission 启发式
- [x] `filterAbsorbedSubagentDelegations` 改为 `parentToolUseId` 级过滤，废除 role Set
- [x] `SubagentStart` 时写入 agent-scoped `@mission`（`buildSubagentMissionAttributedRunEvent`，payload 含 `agentId`）

### Phase 3 — 事件强制 agentId（P1）【已完成】

- [x] `recordThreadRunEventFromLiveEvent`：从 `parent_tool_use_id` 解析 `agentId` / `parentToolUseId`
- [x] `emitSdkStreamActivity`：SDK 事件携带 `parent_tool_use_id` 进 metadata
- [x] `resolveProjectionEventAgentId`：废除 role+时间窗启发式，改用 `parentToolUseId` 精确匹配
- [x] `resolveActivityAgentId`：废除 sole-active 兜底
- [x] 移动端移除 `_findUnclaimedMissionIndex` / `_projectionSubagentRoleOccurrence`
- [x] 移除 OTel activity/usage 管道；工具与 narrative 100% 由 SDK 流驱动
- [x] `mapSdkMessageToEvents`：`tool_use_summary` / `tool_progress` 贯通 `parent_tool_use_id` 与 stream role

### Phase 4 — requestId 贯通（P1）【已完成】
- [x] `recordThreadRunEventFromLiveEvent` / SDK stream emit 携带 registry 中的 `requestId`
- [x] 废除 `req:${threadId}:${eventId}` 合成
- [x] projection / view 废除 `stream:${streamKey}` 合成，仅认 `event.requestId`

### Phase 5 — 审批 agentId 强制（P2）【已完成】

- [x] `BashApprovalRequest` 强制 `agentId`
- [x] `resolveBashApprovalAgentId`：主线程用 plannerAgentId，子代理经 registry 解析
- [x] 删除 legacy `parseBashApprovalActivityText` 合并路径（activity-log，projection-only）

### Phase 6 — 废弃 legacy activity-log 归因（P2）【已完成】

- [x] `activity-log.ts` 子代理分区/occurrence 逻辑标记 deprecated
- [x] 移动端移除 `findProjectionAgentForMission` role-occurrence 兜底
- [x] 移动端移除 `parseBashApprovalActivityText` 合并路径；审批改从 projection metadata 同步
- [x] PC `ActivityLogView` 仅渲染 projection（无 projection 时显示空态）
- [x] 移动端 `buildActivityFeed`：有 projection 时走 `buildProjectionActivityFeed`（仅读 `ThreadRunProjectionSnapshot`）
- [x] 投影未就绪时显示空态（废除 live legacy 回退；`buildLegacyActivityFeed` 仅测试/回放）
- [x] `ThreadSessionNotifier` 停止为 UI 维护 `activities`；live 仅通过 `run_projection_updated` / RPC 更新 projection
- [x] desktop `emitThreadEvent` 停止 live `appendActivityLine` 双写（仅保留 `user_prompt` / `api_error` 供回滚）；renderer 废除 `activityByThread` live 更新
- [x] 删除 deprecated 解析代码：`buildActivityLogBlocks` / occurrence 分区、`parseBashApprovalActivityText`、移动端 `buildLegacyActivityFeed`

## 已较好的路径（保持）

- Bash/Plan/Clarification pending：`toolUseId` keyed
- Projection tool 去重：`metadata.tool.toolUseId`
- Subagent lifecycle：`agent.started` + `delegation*` + `parentToolUseId`
- Billing：`stampedAgentId` → `parentToolUseId` resolver；子代理计费用量仅经 ledger projection / 结构化 `recordSdkUsage` 写入，禁止在 ledger 不可用时回填 `SubagentMetricsRegistry`

## 进度日志

| 日期 | 阶段 | 内容 |
|------|------|------|
| 2026-06-23 | Phase 1 | Runtime SubagentStart 贯通 parentToolUseId（SDK hook toolUseID） |
| 2026-06-23 | Phase 2 | 删除 mission 展示层启发式；filterAbsorbed 改 parentToolUseId |
| 2026-06-23 | Phase 2 | SubagentStart 写入 agent-scoped @mission（含 agentId） |
| 2026-06-23 | Phase 3 | emit/projection 强制 parentToolUseId 归因；移除 sole-active / role 时间窗兜底 |
| 2026-06-23 | Phase 6 | 移动端移除 occurrence mission 启发式 |
| 2026-06-23 | Phase 4 | requestId 贯通：registry + proxy x-request-id + 废除合成 ID |
| 2026-06-23 | Phase 5 | BashApprovalRequest 强制 agentId；activity-log 废除审批文本解析 |
| 2026-06-23 | Phase 6 | activity-log occurrence deprecated；移动端审批/子代理改 projection-only |
| 2026-06-23 | Phase 6 | 移动端 buildProjectionActivityFeed：有 projection 时脱离 activity lines |
| 2026-06-23 | Phase 6 | 移动端废除 live legacy 回退；空态 + projection 主动拉取 |
| 2026-06-23 | Phase 6 | 移动端 session 废除 activities 双写；feed 纯 projection 驱动 |
| 2026-06-23 | Phase 3 | 完全移除 OTel activity/usage 管道；工具与计费仅走 SDK + Proxy |
| 2026-06-23 | Phase 6 | 删除 legacy activity-log / buildLegacyActivityFeed / parseBashApproval 解析 |
