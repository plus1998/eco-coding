# Thread Run Projection / Activity UI Refactor Plan

本文档记录“主代理 / 子代理消息混乱、子代理卡片错乱、请求中状态混乱、计时错误”的全链路重构计划。后续长时间实现必须以本文档为准；如果调整范围、阶段或验收标准，先更新本文档，再改代码。

## 背景

当前 UI 活动流主要由 `apps/desktop/src/renderer/activity-log.ts` 从 `ThreadActivityLine` 文本、`role`、可选 `agentId` 中推断语义，再生成卡片、分组、计时和消息展示。与此同时，主进程已经有 `RunAttemptRecord`、`AgentInstanceRecord`、`UsageLedgerEvent`、`ThreadSubagentSessionRecord`、SubAgent metrics projection 等领域底座，但 renderer 仍在大量依赖文本解析和 role/occurrence fallback。

本次重构目标不是修几个 UI 条件分支，而是把运行展示切到“结构化事件 + 统一运行投影 + 纯 UI 渲染”。

已观察到的具体问题：

- `activity-log.ts` 同时负责过滤、文本解析、分段、合并 stream、子代理 run 推断、duration 计算、React key 生成，职责过重。
- 子代理卡片仍有 role/occurrence 推断路径；同角色并发或 agentId 回填延迟时容易串卡。
- `useStreamRequestTiming` 与 `ActivityLogView.tsx` 的使用方已经发生契约漂移：hook 返回 `waitingMs/ttftMs`，组件读取 `elapsedMs` 并比较不存在的 `"streaming"` phase。
- `thread_activity` 只持久化文本行、role、stream、可选 agentId/apiError；结构化信息缺口导致 renderer 必须猜。
- request status、thread status、run attempt status、subagent status、stream status 分散，缺少统一优先级。

## 总目标

- 新线程的运行展示只依赖结构化运行投影，不再依赖 activity 文本正则推断。
- `agentId` 成为子代理分组主键；`role` 只做展示标签和 legacy fallback。
- 请求状态和计时由显式 request span 状态机派生，不由 React 组件本地猜测。
- 用量、成本、context、SubAgent metrics 均来自现有 ledger/lifecycle/context 投影，不再由 renderer 拼接多个半成品来源。
- 无法归因的数据必须显式暴露为 diagnostic/unattributed，不能静默归到 planner 或最近 active role。

## 不做事项

- 不迁移、不回填历史 `thread_activity` 数据；旧线程走 legacy/best-effort 展示。
- 不重做已完成的 usage ledger、billing projector、agent lifecycle 底座。
- 不做视觉大改版；本批只改信息架构、状态正确性和卡片稳定性。
- 不把 context occupancy 当作 billing usage。
- 不用 role fallback 作为新数据最终归因规则。

## 目标接口

新增 shared IPC 类型 `ThreadRunProjectionSnapshot`，作为 renderer 新路径的唯一展示输入：

- `thread`: `threadId`、`status`、`message`、`currentAttemptId`、`generatedAt`。
- `attempts`: 每次 run attempt 的 `attemptId`、`phase`、`retryIndex`、`status`、`startedAt`、`endedAt`。
- `agents`: 以 `agentId` 为主键，包含 `role`、`kind`、`status`、`parentAgentId`、`parentToolUseId`、`mission`、`todoId`、`startedAt`、`endedAt`、`latestActivity`、`usage`、`context`。
- `requestSpans`: 以 request/span id 为主键，包含 `ownerAgentId`、`role`、`source`、`status`、`retryIndex`、`startedAt`、`firstTokenAt`、`endedAt`、`error`。
- `timeline`: 已分好归属的展示事件，包含 `scope: "main" | "agent" | "both"`、`agentId?`、`kind`、`text/metadata`、`streamState`。
- `diagnostics`: 投影时发现的结构缺口，例如 `missing_agent_id`、`orphan_stream_finalize`、`negative_duration`、`request_span_left_open`、`ambiguous_subagent_role`。

新增 IPC channel：

- `thread:run-projection-get`: 读取指定线程的最新 projection。
- live event 使用现有 `thread-events:subscribe`，新增类型 `thread.run_projection_updated`，payload 带 `projection`。

新增持久化表：

- `thread_run_events`: append-only 结构化展示/审计事件。
- 建议字段：`id`、`thread_id`、`run_attempt_id`、`agent_id`、`parent_agent_id`、`parent_tool_use_id`、`role`、`event_type`、`scope`、`stream_state`、`message`、`metadata_json`、`observed_at`、`sequence`。

保留旧表：

- `thread_activity` 继续作为 transcript、legacy display、继续对话兼容输入。
- 新线程仍可写 `thread_activity`，但新 UI 语义不从它反推。

## 阶段 0：基线与护栏

状态：Completed

目标：先把现状问题固定成可验证清单，避免实现中把旧问题搬到新投影。

工作项：

- 建立本计划的测试清单，覆盖主/子代理消息、同角色并发、请求状态、计时、retry、失败、取消。
- 记录当前 `bunx tsc -b --pretty false` 的全局失败基线；本计划相关文件的新增/现有错误必须在后续阶段清零。
- 标记 legacy 与新路径边界：`activity-log.ts` 只保留旧线程 fallback，新路径不再新增解析逻辑。

验收标准：

- 有明确测试文件或 TODO 测试列表。
- 计划相关类型错误清单明确包含 `ActivityLogView.tsx` / `useStreamRequestTiming` / `activity-log.ts` 的当前漂移。
- 后续每阶段都能说明是否改变新 projection 主路径。

当前基线记录：

- `bunx tsc -b --pretty false` 当前全局失败，不作为 Phase 0 阻塞项；其中与本计划直接相关、后续必须清零的错误包括：
  - `apps/desktop/src/renderer/ActivityLogView.tsx`: `StreamRequestTiming` 被读取不存在的 `elapsedMs`，并比较不存在的 `"streaming"` phase。
  - `apps/desktop/src/renderer/useStreamRequestTiming.ts`: `useRef` 初始化与严格类型不匹配。
  - `apps/desktop/src/renderer/activity-log.ts`: `exactOptionalPropertyTypes` 下的 `status/statusLine/detail` 等 optional 字段漂移，以及 phase block 类型收窄错误。
- 新增测试文件目标：
  - `apps/desktop/test/thread-run-events.test.ts`: 结构化事件 store、sequence、metadata 容错。
  - `apps/desktop/test/thread-run-projection.test.ts`: 同角色并发、planner/subagent 分离、request span、diagnostics。
  - `apps/desktop/test/thread-run-projection-ipc.test.ts`: IPC projection 读取与 live update 组合逻辑。
  - `apps/desktop/test/thread-run-projection-renderer.test.tsx` 或等效 renderer 单测：projection view-model 渲染与卡片 key 稳定性。
- 新路径边界：完成 Phase 5 前 renderer 仍可使用 legacy `activity-log.ts`；Phase 5 完成后，新线程主展示不得再通过 `buildActivityLogBlocks` 生成。

## 阶段 1：结构化运行事件契约与持久化

状态：Completed

目标：把 UI 需要的语义从“文本行”提升为结构化事件。

工作项：

- 新增 `ThreadRunEvent` 类型与 event kind 枚举。
- 新增 `thread_run_events` schema、store API：append/list/clear by thread。
- 所有新事件必须尽量携带 `runAttemptId` 与 `agentId`；缺失时写明 `metadata.reason`。
- 定义 stream 事件规则：placeholder、delta、finalize 必须共享 stable stream key。
- 定义 request span 事件规则：request started、first token、completed、failed、cancelled、retry scheduled。

验收标准：

- append-only 写入幂等或至少有稳定 sequence 排序。
- store 单测覆盖：按 thread/sequence 回放、metadata JSON 容错、清理线程数据。
- 新事件不改变旧 UI 行为；本阶段只 shadow write。

## 阶段 2：主进程事件标准化接入

状态：Completed

目标：把 SDK、Proxy、OTel、thread status、SubagentStart/Stop 接入结构化事件，不再让 renderer 从文本里猜。

工作项：

- 新增 `thread-run-event-normalizer`，将 raw SDK event、proxy usage、OTel activity、thread status、tool activity 映射为 `ThreadRunEvent`。
- `SdkStreamActivityBridge` 保留现有文本输出，但同时 shadow write structured event。
- `AgentLifecycleService` 的 start/stop/run attempt finalizer 同步产生 agent/request/lifecycle event。
- auto retry 每次 attempt 产生新的 request span，retry banner 作为 main timeline event。
- API failure 使用结构化 `apiError` metadata，不只写人类可读文本。

验收标准：

- 并发同角色子代理事件都带不同 `agentId`，无法确定时进入 diagnostic。
- stream finalize 找不到 pending stream key 时产生 `orphan_stream_finalize` diagnostic。
- request failure 不会隐藏在子代理卡片内部，projection 能把它 surface 到 main scope。
- shadow write 不影响旧 `thread_activity` 和旧继续对话路径。

## 阶段 3：运行投影服务

状态：Completed

目标：从结构化事件和已有领域状态生成 renderer 可直接消费的 view-model。

工作项：

- 新增 `thread-run-projection` 纯函数。
- 输入包括：`RunAttemptRecord[]`、`AgentInstanceRecord[]`、`ThreadRunEvent[]`、ledger billing projection、context snapshot、SubAgent session timing。
- 输出 `ThreadRunProjectionSnapshot`，其中 `agents` 以 `agentId` 排序和索引，`timeline` 已分主 feed 与 agent card 内容。
- 子代理卡片标题优先级：mission summary -> todo title -> role display label。
- 子代理状态行优先级：latest actionable activity -> structured error -> running/waiting/completed fallback。
- duration 只由 `startedAt/firstTokenAt/endedAt/now` 派生，禁止使用 React 组件本地 anchor 猜测历史耗时。

验收标准：

- 同角色并发子代理不串卡。
- agentId 延迟出现或回填时，projection key 不变化或能明确重新绑定。
- planner thinking 与 subagent narrative 分离。
- usage/context 显示来自 ledger/context projection，而不是 renderer 按 role 查多个 map。
- projector 单测覆盖成功、失败、取消、retry、streaming、unattributed。

## 阶段 4：IPC 与 live projection 更新

状态：Completed

目标：让 renderer 通过一个入口读取和订阅运行投影。

工作项：

- 新增 `thread:run-projection-get` IPC。
- 主进程在结构化事件写入、usage/context/subagent timing 更新、run attempt 状态变化后触发 projection refresh。
- live event `thread.run_projection_updated` 带完整 snapshot；renderer 直接替换当前 thread projection。
- 保留旧 `threadActivityList`、`threadSubagentSessionsList`、`threadSubagentMetricsList` IPC 给 legacy 和旁路面板使用。

验收标准：

- 打开线程时一次读取 projection 即可渲染主 feed、子代理卡片、请求状态、用量、context。
- live 更新不要求 renderer 先收到 activityLine、再收到 metrics、再收到 timing 才能拼出正确卡片。
- projection refresh 有节流或去重，避免高频 stream 造成 UI 抖动。

## 阶段 5：Renderer 切换

状态：Completed

目标：将新线程 UI 从 legacy `activity-log.ts` 切到 projection view-model。

工作项：

- `App.tsx` 增加 `runProjectionByThread` state。
- `ActivityLogView` 新增 projection 渲染路径；新路径不调用 `buildActivityLogBlocks`。
- 子代理卡片 key、展开状态、data attributes 全部使用 `agentId`。
- `useStreamRequestTiming` 契约修复：统一返回 `phase/waitingMs/ttftMs/elapsedMs`，或改名后同步所有使用方。
- 删除新路径上的 role/occurrence duration fallback。
- 保留 legacy renderer：没有 projection 或旧线程打开时走旧 `activity-log.ts`。

验收标准：

- 主代理消息只出现在 main feed；子代理消息只出现在对应 agent card，除非 event scope 明确为 `both`。
- 请求中、等待首 token、streaming、完成、失败、取消的 UI 状态与 request span 一致。
- 同角色并发子代理卡片展开/收起不会互相影响。
- `ActivityLogView.tsx` 与 timing hook 相关 TypeScript 错误清零。

## 阶段 6：诊断、测试与回归

状态：Completed

目标：用测试和诊断防止状态混乱回归。

工作项：

- 新增投影单测：
  - 同角色并发 coder 两张卡不串线。
  - planner thinking 与 coder narrative 不合并。
  - stream placeholder 到 first token 的 TTFT 正确。
  - API failure surfaced 到 main feed，且保留 agent card detail。
  - retry 产生多个 attempt/span，最终 UI 显示当前 attempt。
  - cancel/fail 后没有 active request span 残留。
- 新增 store/IPC 单测。
- 更新 renderer 测试，关键旧 `activity-log.test.ts` 用例迁移到 projection 测试。
- 诊断写 `eco-diag`，不得吞掉归因缺口。

验收标准：

- `bun test` 通过。
- `bunx tsc -b --pretty false` 如果仍失败，剩余错误必须与本计划无关；activity/projection/timing 相关错误必须为 0。
- 新 projection 路径有足够测试覆盖，不依赖手工观察。

## 阶段 7：Legacy 收敛

状态：Completed

目标：在新路径稳定后减少重复逻辑和后续维护成本。

工作项：

- 将 `activity-log.ts` 明确标注为 legacy adapter，并禁止新 feature 加入该路径。
- 删除 renderer 新路径中对 `subagentTimingsByAgentId`、`subagentMetricsByAgentId`、`usageByRole` 的拼装依赖。
- 旧线程 fallback 保持可读即可，不追求与新 projection 完全一致。
- 更新 `docs/agent-billing-refactor-plan.md` 的近期执行顺序，指向本计划的完成状态。

验收标准：

- 新线程运行展示不依赖 `ThreadActivityLine` 文本解析。
- legacy path 与 projection path 的边界清晰，后续工程师不会继续在 `activity-log.ts` 修新线程状态 bug。
- 文档阶段状态已更新。

完成记录：

- `activity-log.ts` 已标注为 legacy adapter；新运行 UI 主路径使用 `ThreadRunProjectionSnapshot` 与 `thread-run-projection-view.ts`。
- `ActivityLogView` 在有 projection 时不调用 `buildActivityLogBlocks`；旧 `activityLines`、`subagentTimings`、`subagentMetrics`、`usageByRole` 只服务 legacy fallback。
- 已按阶段提交：
  - `e39c39c`：记录运行态投影重构基线。
  - `8877491`：新增结构化运行事件持久化。
  - `480d5c4`：接入运行事件影子写入。
  - `8657c1a`：实现线程运行投影。
  - `46b5920`：开放运行投影 IPC。
  - `edb3f3b`：切换运行投影界面渲染。
  - `431a25d`：补齐运行投影诊断测试。
- 最终验证：
  - `bun test apps/desktop/test/thread-run-projection.test.ts apps/desktop/test/thread-run-projection-view.test.ts apps/desktop/test/thread-run-events.test.ts apps/desktop/test/thread-run-event-normalizer.test.ts apps/desktop/test/activity-log.test.ts apps/desktop/test/ipc.test.ts`：`81 pass / 3 skip / 0 fail`。
  - `bun run --cwd apps/desktop build`：通过。
  - `bunx tsc -b --pretty false`：仍失败，但剩余错误不再包含 `thread-run-projection*`、`thread-run-events`、`thread-run-event-normalizer`、`ActivityLogView.tsx`、`useStreamRequestTiming.ts`、`activity-log.ts` 或 `ipc.ts` 的本计划相关类型错误；剩余为仓库既有跨模块/strict optional 基线问题。

## 执行顺序

建议按以下顺序提交，避免一次性大改难以回滚：

1. Phase 0 + Phase 1：类型、schema、store 和 shadow event 基础。
2. Phase 2：主进程 shadow write，不切 UI。
3. Phase 3：projection 纯函数和测试。
4. Phase 4：IPC/live snapshot。
5. Phase 5：renderer 新路径，保留 legacy fallback。
6. Phase 6：补齐测试、诊断和 typecheck 相关错误。
7. Phase 7：legacy 收敛和文档状态更新。

每批提交必须包含：

- 影响范围说明。
- 对应阶段的测试。
- `bun test` 结果。
- `bunx tsc -b --pretty false` 结果；如果失败，说明剩余错误是否与本批相关。
