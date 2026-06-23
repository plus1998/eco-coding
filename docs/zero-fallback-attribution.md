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
PreToolUse(Agent) ──toolUseId──► noteTaskToolUse (pending 队列)
        │                              │
        │ mission 文本                  │ role FIFO 消费（❌ 并发同 role 会错）
        ▼                              ▼
   @mission 无 agentId          parentToolUseId 错配
        │                              │
        └──────────► SubagentStart(agentId) ◄────────┘
                           │
                    delegation + parentToolUseId（✓ 若上链正确）
```

## 阶段划分

### Phase 1 — toolUseId ↔ agentId 确定性绑定（P0）【进行中】

- [ ] `PendingSubagentLaunch` 增加 `toolUseId`
- [ ] PreToolUse 归因 hook 将 `toolUseId` 写入 pending launch（同一次 Agent 调用）
- [ ] `SubagentStart` 用 explicit `parentToolUseId` 调用 `link()`，废除 role FIFO 消费
- [ ] `agent-lifecycle-service.startSubagent` 接受 explicit `parentToolUseId`
- [ ] `subagent-metrics-registry.onSubagentStart` 优先 explicit link

**验收**：`subagent-metrics-registry.test.ts` 并发同 role 交错启动仍正确 resolve；`parent_tool_use_unmapped` 归零。

### Phase 2 — Mission 发射带 ID（P0）

- [ ] `@mission` payload 支持 `agentId`（已加字段，待发射路径使用）
- [ ] `agent.started` 的 `delegationPrompt/Summary` 为唯一 mission 源（展示层只读此字段 + parentToolUseId 链）
- [ ] 删除 `buildSubagentMissionTextByAgentId` 及 activity lines mission 启发式
- [ ] `filterAbsorbedSubagentDelegations` 改为 `parentToolUseId` 级过滤，废除 role Set

**验收**：PC/移动端子代理卡 mission 仅来自 delegation 或 parentToolUseId 精确匹配；无 occurrence 代码路径。

### Phase 3 — 事件强制 agentId（P1）

- [ ] `recordThreadRunEventFromLiveEvent`：agent scope 事件无 `agentId` 时拒绝或从 `parentToolUseId` 解析，禁止 `ambiguous_subagent_role`
- [ ] `activity-agent-id` stream key 改用 `agentId`，废除 `${threadId}:${role}`
- [ ] OTel activity 行携带 `parentToolUseId`

### Phase 4 — requestId 贯通（P1）

- [ ] 统一 `requestId`：proxy `x-request-id` → thread run event → projection requestSpans
- [ ] 废除 `req:${threadId}:${eventId}` 合成

### Phase 5 — 审批 agentId 强制（P2）

- [ ] `BashApprovalRequest` 强制 `agentId`
- [ ] 删除 legacy `parseBashApprovalActivityText` 合并路径（projection-only）

### Phase 6 — 废弃 legacy activity-log 归因（P2）

- [ ] `activity-log.ts` 子代理分区/occurrence 逻辑标记 deprecated，新线程不走
- [ ] 移动端 `_projectionSubagentRoleOccurrence` / `_findUnclaimedMissionIndex` 删除
- [ ] 双轨合一：UI 只消费 `ThreadRunProjectionSnapshot`

## 已较好的路径（保持）

- Bash/Plan/Clarification pending：`toolUseId` keyed
- Projection tool 去重：`metadata.tool.toolUseId`
- Subagent lifecycle：`agent.started` + `delegation*` + `parentToolUseId`
- Billing：`stampedAgentId` → `parentToolUseId` resolver

## 进度日志

| 日期 | 阶段 | 内容 |
|------|------|------|
| 2026-06-23 | Phase 1 | 创建本文档；开始 toolUseId↔agentId 确定性绑定 |
