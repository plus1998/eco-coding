# Thread Live Follow-up / Escalation Plan

本文档记录 Eco 支持“线程运行中用户追加消息、Agent 在合适时机引导、必要时强制提升/中断”的实施计划。后续推进必须先更新本文档，再改代码。

核心原则：不要把“运行中已收消息但只能稍后处理”包装成“Agent 已实时读到消息”。当前系统没有真实运行中注入能力，必须分阶段落地并在 UI 上明确表达真实状态。

## 背景

当前 Eco 主线程运行时基于 Claude Agent SDK `query({ prompt })` 单次请求模型：

- 前端 `Composer` 只在 `idle / completed / failed / blocked` 状态允许继续发送。
- 后端 `thread:continue` 显式拒绝 `running / queued` 状态。
- 已有 continuation 能力依赖 SDK `resume`、`resumeSessionAt`、`forkSession`，只能在一次 run 结束或被取消后重新启动。
- 已有引导能力是模型主动调用 `AskUserQuestion`，宿主 UI 暂停等待用户回答后继续。
- 已有强制确认能力是 Bash / tool permission handler，可对安全 Bash 也强制确认，deny 时可选择是否 `interrupt`。

Claude Agent SDK 另有 `runAssistantWorker` / streaming input 类能力，支持 `pushPrompt()` 与 `interrupt()`，更适合运行中追加消息和远程控制。但当前 Eco 主运行时未接入这条路径。

因此本计划拆成两个阶段目标：

- V1：运行中可留言，进入 Eco 自己的待处理队列，在当前 run 安全结束或进入等待点后自动处理。
- V2：真实运行中注入，切到 streaming input / assistant worker 或等价抽象，让 Agent 在工具间隙或模型 turn 边界处理新消息，并支持强制提升。

## 最终目标

用户可以在 Agent 工作过程中继续输入：

- 普通追加：系统记录并在合适时机合并到当前任务，不产生并发 run。
- 状态追问：Agent 能在不破坏任务的情况下短答或稍后回答。
- 需求变更：Agent 能识别是否需要继续执行、修订计划或重新规划。
- 强制提升：用户可显式要求立即停止当前路径，优先处理最新消息。
- 审批/澄清：AskUserQuestion、Bash approval 与追加消息互不丢失，优先级清晰。

最终系统必须满足：

- 不允许同一线程两个主 run 同时写同一 worktree。
- 追加消息必须持久化，崩溃/重启后可恢复或明确标记失效。
- UI 必须区分 queued、delivered、applied、superseded、failed。
- 强制提升必须经过统一中断/恢复路径，不能绕过 pending plan、billing、cleanup。
- continuation 路由必须复用现有 intent / plan / execution 状态判断，避免另起一套隐式状态机。
- 无法实时注入时必须明确展示“已排队”，不能暗示 Agent 已读。

## 非目标

- V1 不实现模型运行中的实时插话。
- V1 不改 Claude SDK 调用模式，不引入 streaming input。
- V1 不允许用户在运行中修改 agent profile / route profile / orchestration mode。
- V1 不支持在一个运行中的 Bash approval 上同时提交普通 follow-up。
- 本计划不替代 `AskUserQuestion`；澄清问题仍由模型主动提出，运行中留言是用户主动追加。

## 关键术语

### Live Follow-up

用户在线程非空闲状态下提交的新消息。它不是新的 thread，也不是立即启动的新 run。

### Delivery Mode

追加消息进入 Agent 的方式：

- `queued`: Eco 只记录，等待当前 run 结束或等待点。
- `resume`: 当前 run 结束后用 SDK resume 启动 continuation。
- `interrupt_resume`: 先中断当前 run，再用 resume 处理最新消息。
- `streaming_push`: V2 中直接推入当前 SDK 输入流。

### Escalation

用户明确要求“现在处理 / 停止当前 / 改方向 / 优先这个”的行为。Escalation 不是普通排队，而是请求系统改变当前 run 生命周期。

### Safe Boundary

Eco 可以处理 queued follow-up 的边界：

- 当前 run completed / failed / blocked。
- 当前 run cancelled 且 cleanup 已完成。
- thread 进入 `awaiting_plan`。
- thread 进入 `clarification.requested` 或 `bash_approval.requested` 等用户等待态。
- V2 中 SDK worker 空闲、工具间隙、模型 turn 完成或 `interrupt()` 成功后。

## V1 产品行为

### 普通运行中留言

用户在 `running / queued` 状态输入消息：

- Composer 允许发送文本和附件，但 route/profile controls 保持禁用。
- 后端不调用 `thread:continue`，而是调用新的 `thread:follow_up_enqueue`。
- 消息写入 pending follow-up store。
- UI 在活动流显示：“已记录，将在当前步骤结束后处理。”
- 当前 run 不被打断。

当 run 进入 safe boundary：

- 如果 pending follow-up 为空，不做事。
- 如果只有一条，自动按现有 continuation 路由处理。
- 如果多条，默认合并为一次 follow-up，保留时间顺序。
- 如果最新消息显式要求重新规划，走 planning continuation / revise plan。
- 如果当前状态是 `awaiting_plan`，优先把 follow-up 作为计划修改意见，而不是直接执行。

### 运行中强制提升

用户点击“立即处理”或发送明确命令：

- UI 二次确认文案必须说明：会停止当前运行并用最新消息恢复继续，当前未落盘的工具步骤可能无法保留。
- 后端标记 latest pending follow-up 为 `escalated`。
- 对当前 active run 调用现有 abort/cancel 路径。
- cleanup 完成后，使用 `resume` 或 fallback prompt context 处理 escalated follow-up。
- 如果无法 resume，线程进入 blocked，消息显示“无法恢复 SDK 会话，请重新发送完整需求。”，不能静默 fresh start。

### 与等待态的关系

如果当前线程正在等待 `AskUserQuestion`：

- 普通 follow-up 不直接当作澄清答案。
- UI 应优先提示用户回答上方问题。
- 用户可选择“作为说明提交到当前问题”，这走现有 clarification submit。
- 用户也可选择“排队为后续消息”，这进入 pending follow-up queue。

如果当前线程正在等待 Bash approval：

- 普通 follow-up 进入队列。
- “强制提升”需要先拒绝/取消当前 Bash approval，再 abort run。
- 不允许在 Bash approval 未决时直接启动新 continuation。

## V2 产品行为

V2 引入真实运行中注入能力，优先评估 Claude Agent SDK streaming input / `runAssistantWorker`：

- 线程 active run 保存 SDK worker handle。
- 普通追加调用 `pushPrompt()` 或等价 input stream enqueue。
- 强制提升调用 `interrupt()`，然后按最新消息恢复或继续。
- Agent 在 system prompt 中获得明确规则：收到用户后续消息时，判断短答、合并、暂停、重规划或终止。

V2 必须仍保留 V1 queue：

- SDK push 失败时消息不能丢，降级为 queued。
- app 重启后没有 live handle 时，pending follow-up 走 resume。
- billing / cleanup / projection 仍以 run attempt 为边界。

## 目标接口

### Shared Types

新增 shared 类型，建议放在 `apps/desktop/src/shared/thread-live-follow-up.ts` 或合并到 `ipc.ts`：

```ts
type ThreadFollowUpStatus =
  | "queued"
  | "delivered"
  | "applied"
  | "superseded"
  | "cancelled"
  | "failed";

type ThreadFollowUpPriority = "normal" | "escalated";

type ThreadFollowUpDeliveryMode =
  | "queued"
  | "resume"
  | "interrupt_resume"
  | "streaming_push";

interface ThreadPendingFollowUp {
  id: string;
  threadId: string;
  prompt: string;
  attachments?: PromptImageAttachment[];
  priority: ThreadFollowUpPriority;
  status: ThreadFollowUpStatus;
  deliveryMode: ThreadFollowUpDeliveryMode;
  createdAt: string;
  updatedAt: string;
  deliveredAt?: string;
  appliedAt?: string;
  sourceRunAttemptId?: string;
  targetRunAttemptId?: string;
  error?: string;
}
```

### IPC

新增 IPC channel：

- `thread:follow-up-enqueue`: 运行中提交普通 follow-up。
- `thread:follow-up-escalate`: 将某条 pending follow-up 升级为强制处理；没有 pending 时可携带新 prompt 创建 escalated follow-up。
- `thread:follow-up-list`: 读取当前线程 pending / history。
- `thread:follow-up-cancel`: 取消尚未 delivered 的 follow-up。

Live event：

- `thread.follow_up.queued`
- `thread.follow_up.delivered`
- `thread.follow_up.applied`
- `thread.follow_up.escalated`
- `thread.follow_up.cancelled`
- `thread.follow_up.failed`

### Store

新增持久化表或 conversation-store API：

- append follow-up。
- list by thread/status。
- mark delivered/applied/failed/cancelled。
- atomically claim next follow-up，避免 run cleanup 与用户再次点击同时触发两次 continuation。

排序规则：

- escalated 优先。
- 同优先级按 `createdAt` 升序。
- 多条 normal 默认合并。
- 多条 escalated 只保留最新为 active，旧 escalated 标记 `superseded`。

## 后端执行设计

### Enqueue Path

前端在 `activeThread.status` 非 continuable 但允许 live follow-up 的状态下调用 enqueue。

后端校验：

- thread 存在。
- thread status 是 `running / queued / awaiting_plan` 或等待 clarification / bash approval。
- runtimeConfig 不可在 enqueue 时修改。
- 附件必须满足现有图片能力限制。

后端动作：

- 写 pending follow-up。
- append activity line 或 structured run event。
- emit live event。
- 返回 pending follow-up 列表和 thread summary。

### Safe Boundary Drain

在这些位置尝试 drain：

- `finalizeMainThreadRunCleanup` 之后。
- `applyMainThreadRunDecisionEffects` 完成 completed/failed/blocked/awaiting_plan 更新后。
- `dismissPendingPlan` 后，如果用户忽略计划且已有 follow-up。
- clarification answered 后，不自动 drain；继续当前 run。
- Bash approval resolved 后，不自动 drain；继续当前 run。

Drain 伪流程：

```ts
async function drainPendingFollowUps(threadId: string, boundary: SafeBoundary) {
  const claimed = followUpStore.claimNextBatch(threadId, boundary);
  if (!claimed.length) return;

  const prompt = buildFollowUpPrompt(claimed);
  const action = resolveThreadContinueAction(...existingSignals, followUp: prompt);
  markDelivered(claimed, action);
  await dispatchThreadContinueAction(...);
}
```

必须防止递归：

- drain 启动的新 run 本身完成时可以再次 drain，但同一 cleanup tick 只能 claim 一批。
- 如果 thread 已经被用户手动启动 continuation，不自动 drain。

### Escalation Path

强制提升流程：

1. 创建或更新 pending follow-up 为 `escalated`。
2. 如果有 pending clarification，先提示用户选择：取消澄清并提升，或先回答澄清。
3. 如果有 pending Bash approval，默认拒绝/取消 approval，并记录原因。
4. 调用 `activeRunRuntimeState.abortRun(threadId, "superseded by user follow-up")`。
5. 等 cleanup 完成后 drain escalated follow-up。
6. 如果 abort 超时，线程 blocked，pending follow-up 保持 `queued` 并显示错误。

V1 不直接使用 SDK `interrupt()`；沿用 Eco 已有 abort/cancel 语义。V2 再接 SDK handle 的 `interrupt()`。

## Prompt / Agent 行为规则

Continuation prompt 需要补充一段稳定规则：

- “User follow-up” 是用户在前一轮运行期间追加的最新指令。
- 如果它只是询问状态，简短回答并继续原任务。
- 如果它补充约束，合并到当前任务并说明影响。
- 如果它与已批准计划冲突，停止执行并转为更新计划。
- 如果它要求撤销/停止/换方向，不要继续原执行路径。

Plan Mode continuation 仍要求输出完整 replacement plan，不允许 delta plan。

Execution continuation 需要引用 approved plan snapshot；如果 follow-up 改变目标，需要回到 planning，而不是在执行阶段即兴改大范围方案。

## 前端 UX

### Composer

运行中：

- 输入框可用。
- Send 按钮变为“排队发送”。
- Stop 按钮保留。
- 增加“立即处理”二级按钮或发送后在 pending item 上提供提升操作。

禁用项：

- route profile。
- agent profile。
- orchestration mode。
- subagent toggles。
- rewind target。

### Activity Feed

新增 pending follow-up 卡片：

- `queued`: “已记录，将在当前步骤结束后处理。”
- `delivered`: “已交给 Agent 处理。”
- `applied`: “已应用到本次续聊。”
- `escalated`: “已请求立即处理，正在停止当前运行。”
- `failed`: 显示真实失败原因。

### Pending List

同线程最多展示最近 3 条 pending：

- 支持取消尚未 delivered 的消息。
- 支持把 normal 提升为 escalated。
- 多条合并时显示“将合并 N 条后续消息”。

## 阶段 0：基线与测试护栏

状态：Completed

目标：冻结当前真实行为，避免后续把运行中追加误接成并发 run。

工作项：

- 新增/扩展测试确认 `running / queued` 下当前 `thread:continue` 被拒绝。
- 测试 `isContinuableThreadStatus` 不包含 running / queued / awaiting_plan。
- 测试 AskUserQuestion 与 Bash approval 的 pending bridge 当前行为。
- 文档中记录当前缺口：没有 live input queue，没有 SDK worker handle，没有 streaming push。

验收标准：

- 测试明确证明当前不能运行中继续。
- 后续阶段若放开 UI，必须通过新 enqueue API，而不是直接绕过 `thread:continue`。

完成记录：

- `isContinuableThreadStatus` 测试明确覆盖 `queued / running / awaiting_plan` 不可继续，`idle / completed / failed / blocked` 可继续。
- Phase 0 提交时 IPC 测试记录过尚无 live follow-up channel；Phase 1 引入 channel 后已更新该基线。
- Clarification bridge 测试覆盖 pending clarification 的 submit/cancel 生命周期。
- Bash approval bridge 测试覆盖 pending approval 的 resolve/cancel 生命周期，作为后续 live follow-up 等待态分流的基线。

## 阶段 1：Pending Follow-up Store 与 IPC

状态：Completed

目标：先让用户运行中留言不丢，但不改变当前 run。

工作项：

- 新增 pending follow-up 类型、store API、IPC channel。
- `conversation-store` 持久化 pending follow-up。
- renderer 获取并订阅 pending follow-up。
- enqueue 时写 activity / live event。

验收标准：

- 运行中 enqueue 不启动新 run。
- app 重启后 pending follow-up 仍可读取。
- 取消 pending follow-up 后不会被 drain。
- 多条 pending 按优先级和时间稳定排序。

完成记录：

- 新增 `ThreadPendingFollowUp` 及 enqueue/escalate/list/cancel IPC 类型和 channel。
- `conversation-store` 新增 `thread_pending_followups` 表、thread-owned 清理、enqueue/list/get/status/cancel/escalate/事务式 claim API。
- 主进程 IPC 只负责持久化和 live event，不启动 continuation，不自动 drain。
- preload 暴露 follow-up enqueue/escalate/list/cancel 方法，renderer 后续阶段可直接接入。
- store 单测覆盖排序、附件持久化、提升 supersede、取消、claim、deleteThread 清理。

## 阶段 2：Renderer 运行中发送 UX

状态：Completed

目标：开放运行中留言入口，并诚实展示“排队”状态。

工作项：

- `Composer` 在 running/queued 时允许输入，但调用 enqueue。
- waiting clarification / bash approval 时显示明确提示和分流操作。
- activity feed 展示 follow-up 状态卡片。
- route/profile/subagent controls 在运行中保持禁用。

验收标准：

- 用户能在 running 时提交消息。
- UI 不显示“正在处理该消息”，只显示 queued。
- pending clarification 不会被普通 follow-up 意外提交为答案。
- pending Bash approval 不会因 follow-up 启动并发 continuation。

完成记录：

- Renderer 新增 thread-scoped pending follow-up state，selected thread/refresh/live event 都会同步队列。
- Composer 在 `running / queued` 时保持可输入，发送调用 `enqueueThreadFollowUp`，不触发 `continueThread/startThread`。
- clarification / bash approval 等待态下 composer 文案明确为“排队后续消息”，回答问题和命令审批仍由上方专用 panel 处理。
- Activity feed 新增 queued follow-up 状态卡片，展示排队数量、消息预览、图片数量和取消入口。
- route/profile/subagent controls 继续复用 `canEditComposerConfig`，运行中保持禁用。
- 本阶段仍不处理 `awaiting_plan` 的计划修改 drain，也不实现强制提升；这些保持在 Phase 3/4。

## 阶段 3：Safe Boundary Drain

状态：Completed

目标：当前 run 到安全边界后自动处理 pending follow-up。

工作项：

- 在 run cleanup / decision effects 后调用 drain。
- 复用 `resolveThreadContinueAction`、`dispatchThreadContinueAction`。
- 实现多条 normal follow-up 合并 prompt。
- 实现 delivered/applied/failed 状态更新。

验收标准：

- completed 后自动续聊。
- failed/blocked 后若可 resume，自动续聊；不可 resume 时显示失败。
- awaiting_plan 下 follow-up 作为计划修改意见进入 planning continuation。
- 不会出现两个 active run。
- follow-up delivery 失败不丢消息。

完成记录：

- `finalizeMainThreadRunCleanup` 在 `finishActiveRun` 后触发 queued follow-up drain，因此不会和当前 active run 并发。
- 手动继续和自动 drain 复用同一个 `startThreadContinuation` helper，继续使用 `resolveThreadContinueAction` / `dispatchThreadContinueAction`。
- 多条已领取 follow-up 合并为一个 prompt，图片附件按顺序聚合后随 continuation 发送。
- drain 会将 queued 标记为 delivered，成功启动续跑后标记 applied；启动失败时标记 failed 并保留原 follow-up、错误原因和 activity event。
- `completed / failed / blocked / awaiting_plan` 会尝试 drain；`failed / blocked` 要求存在可恢复 SDK 会话，否则标记 failed。
- 本阶段刻意不在 `idle` 自动 drain，避免用户主动停止后又自动继续。

## 阶段 4：V1 强制提升

状态：Completed

目标：用户可以要求立即处理，但仍走 Eco 现有 abort + resume 路径。

工作项：

- 新增 escalate IPC。
- UI 提供“立即处理”动作和确认。
- escalation 触发 active run abort。
- cleanup 后 drain escalated follow-up。
- Bash approval / clarification 未决时提供明确分流。

验收标准：

- 强制提升不会绕过 cleanup。
- abort 成功后用最新 escalated follow-up 恢复。
- abort 失败或无法 resume 时，pending 状态和错误原因可见。
- 已 superseded 的旧 escalated 消息不会再次执行。

完成记录：

- Renderer 队列卡片新增“立即处理”动作，点击前需要确认；escalated 项显示为“立即”状态。
- escalate IPC 现在会在持久化 escalated follow-up 后触发 active run abort，并取消未决 clarification/bash approval。
- abort 成功后写入 `pendingEscalatedFollowUpDrain` 标记；cleanup 即使把 thread 收到 `idle`，也只对该标记触发一次 forced drain。
- forced drain 要求存在可恢复 SDK 会话；无法恢复时将 follow-up 标记为 failed，并写入错误 activity event。
- drain 检测到 queued escalated 时只领取 escalated follow-up，普通 queued 留到后续安全边界；旧 escalated 会被 store supersede，不会再次执行。

## 阶段 5：Prompt 与路由质量

状态：Not Started

目标：让 Agent 收到 queued follow-up 后能正确选择短答、合并、重规划或停止。

工作项：

- 补充 planning continuation prompt。
- 补充 execution continuation prompt。
- 为 follow-up 添加 metadata：queuedDuringPhase、sourceRunAttemptId、boundary。
- 扩展 intent classifier 或 continuation routing，识别“停止/换方向/先回答问题/重新规划”。

验收标准：

- “状态怎么样”不会触发无意义重规划。
- “先别做 A，改做 B”会转 planning 或 interrupt_resume。
- “继续，但加测试”会合并到 execution。
- “重新规划”保持现有 planning continuation 语义。

## 阶段 6：V2 SDK Streaming / Assistant Worker 调研与 Spike

状态：Not Started

目标：验证真实运行中注入的 SDK 路径，而不是继续用 queue 模拟。

工作项：

- 建立 isolated spike，比较 `query(prompt: AsyncIterable)`、streaming input、`runAssistantWorker.pushPrompt()`。
- 验证当前 Claude Agent SDK 版本对 tools、hooks、mcpServers、systemPrompt、sessionStore、resume、billing events 的支持差异。
- 验证 `interrupt()` 对当前 tool、subagent、Bash approval、partial usage 的实际行为。
- 评估是否能保留现有 `consumeSdkRunEvents`、billing、projection、subagent resume。

验收标准：

- 有可重复本地 spike 或测试。
- 明确选择 V2 技术路线。
- 明确哪些现有功能需要适配，哪些暂不支持。
- 如果 SDK 能力不足，文档更新为暂缓，不做假实时。

## 阶段 7：V2 Live Input Runtime

状态：Not Started

目标：让当前 run 真正接收运行中追加消息。

工作项：

- `activeRunRuntimeState` 保存 live input handle。
- 新增 delivery mode `streaming_push`。
- enqueue 后优先 push，失败则降级 queued。
- escalation 优先调用 SDK `interrupt()`，失败再走 Eco abort。
- run projection 显示 delivered/applied 的真实事件。

验收标准：

- 普通追加能在当前 SDK session 内被 Agent 读取。
- 强制提升能中断当前路径并处理最新消息。
- push 失败不会丢消息。
- billing、usage、cleanup、subagent metrics 不回退。

## 测试计划

### Unit

- `thread-live-follow-up-store.test.ts`
  - enqueue/list/cancel/claim。
  - priority ordering。
  - supersede escalated。
  - crash-safe status transitions。

- `thread-live-follow-up-routing.test.ts`
  - completed -> resume execution。
  - awaiting_plan -> planning continuation。
  - blocked with no SDK resume -> failed visible。
  - multiple normal merge。
  - escalated latest wins。

- `thread-continuation.test.ts`
  - running 仍不是 continuable。
  - live follow-up 不复用 `thread:continue`。

### Main Process

- `thread-follow-up-ipc.test.ts`
  - running enqueue succeeds。
  - idle enqueue rejected or routed to normal continue。
  - invalid attachments rejected。
  - pending clarification / bash approval 分流。

- `thread-follow-up-drain.test.ts`
  - cleanup 后自动 drain。
  - no double dispatch。
  - drain failure preserves pending state。
  - manual continue 与 drain 竞争只执行一次。

### Renderer

- `live-follow-up-ui.test.tsx`
  - running composer enabled for message only。
  - route controls disabled。
  - queued/applied/failed 状态展示。
  - clarification 优先提示。
  - escalation confirm flow。

### Integration / Smoke

- 运行中发普通 follow-up，当前 run 完成后自动续聊。
- 运行中发“重新规划”，当前 run 结束后生成 replacement plan。
- 运行中点击立即处理，当前 run 被取消并 resume。
- Bash approval 未决时发 follow-up，不启动并发 run。
- App 重启后 pending follow-up 仍可处理。

## 风险与处理

- 并发 run 写同一 worktree：所有 live follow-up 必须先入队，drain 必须 claim 锁。
- SDK resume 不可用：不能 fresh start 伪装恢复；必须 blocked 并提示用户重新发送完整需求。
- 用户以为 Agent 已读 queued 消息：UI 文案必须写“已记录/待处理”，不能写“已发送给 Agent”。
- 强制提升中断半途工具：统一走已有 cancel cleanup，不能直接启动新 run。
- 附件能力差异：运行中附件 V1 只随 queued follow-up 进入下一轮；V2 push 前必须验证 SDK 是否支持对应 content shape。
- AskUserQuestion 混淆：普通 follow-up 不自动作为澄清答案，除非用户显式选择。

## 默认决策

- V1 默认做 queue，不做实时注入。
- V1 默认普通 follow-up 不打断当前 run。
- V1 默认多条 normal 合并为一次 continuation。
- V1 默认 escalated 只保留最新 active。
- V1 默认无法 resume 就 blocked，不自动 fresh plan。
- V2 只有 SDK spike 证明能力后再推进。

## 完成定义

V1 完成：

- 用户可在运行中留言。
- 留言不会丢。
- 留言不会造成并发 run。
- 留言在 safe boundary 自动进入现有 continuation。
- UI 明确显示 queued/delivered/applied/failed。
- 强制提升可通过 abort + resume 工作，并暴露失败。

V2 完成：

- 用户追加消息可在当前 SDK live session 中被 Agent 读取。
- Agent 可在工具间隙或模型 turn 边界按规则处理。
- 用户可强制提升并触发 SDK interrupt。
- V2 失败时可可靠降级到 V1 queue。
- 现有计费、投影、cleanup、subagent metrics 不退化。
