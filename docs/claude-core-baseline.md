# Claude Core baseline（streaming 地基 + mid-turn）

本文记录 Eco 对 Claude Agent SDK（`@anthropic-ai/claude-agent-sdk` **0.3.223**）的接线约定：
Query 启动 / 生命周期地基，以及产品级 mid-turn **held prompt mailbox**（`HeldPromptStream.push`，非第二次 `query.streamInput`）。

## 会话启动模型

- Thread 主路径（`run` / `runAsk` / `runPlan` / `runContinuation`）统一为 **streaming input 模式**：
  `sdk.query({ prompt: createHeldPromptStream(text), options })`。
- `createHeldPromptStream` 先 yield 初始用户消息，然后阻塞在队列上，**直到 query teardown `close()`**。
  同 run 内后续用户文本经 `HeldPromptStream.push` 注入同一条 iterable，**禁止**再调 `query.streamInput`。
- `toStreamingUserPrompt` 仅用于 rewind 等一次性 prompt（yield 一条即结束）。
- Slash 命令仍走同一条 streaming user message。
- Rewind 使用空内容 streaming prompt + `rewindFiles`。

## Query 生命周期

```text
create query (held prompt stream / mailbox)
  → onOpen(handle)
  → consume iterator until end or AbortSignal
  → onClosing(handle)  // port rejects new push; await inflight
  → promptStream.close()  // iterable ends; SDK may endInput
  → teardown:
      if aborted: interrupt（幂等；still_queued 供调和）
      有界 drain
      query.close()
  → onClosed(handle, { stillQueued })
```

- 正常结束与 abort 路径 **都会** `close`。
- `ClaudeQueryHandle.pushUserMessage`：仅 `phase === "open"` 时 `promptStream.push`；带截止时间；失败抛错。
- Accept = 该条已被唯一 `streamInput` 的 prompt iterator 取走（非模型答完；非 `streamInput()` 函数返回）。
- Probe：`stream_input_ok` / `stream_input_error` / `stream_input_timeout` / `interrupt*` / `query_teardown`。

## Mid-turn 产品交付（Desktop）

| 条件 | deliveryMode | 行为 |
| --- | --- | --- |
| 设置 `followUpDeliveryMode=queue`（非 escalated） | `queued` | **不** mid-turn；回合结束后 drain |
| Claude + 纯文本 + port accepting + push 被 prompt iterator 取走 | `streaming_push` | 已注入当前 Query；status=`applied`；**claim 后立刻写 `thread.user_prompt`（turn 之间）** |
| Codex + 纯文本 + port accepting + turn/steer 成功 | `streaming_push` | 同上；**claim 后立刻写 `thread.user_prompt`** 供 Feed/bind |
| 附件 / 无 port / 明确拒绝 / 非 Claude·Codex | `queued` → 结束后 `resume` | 现网 queue drain |
| push 超时 / 传输断连 | `streaming_push` + `failed` | 交付状态未知；**不**自动重发；本地用户气泡已在 claim 后插入 |
| escalated 且 push 失败 | `interrupt_resume` | abort + force drain |

- 设置默认：`steer`（偏好 mid-turn）；`queue` 仅排队。UI：设置 → 常规 → 跟进处理方式；`⌘↩` 对单条消息取反。
- **Steer 路径不提前广播 `thread.follow_up.queued`**：仅在 mid-turn 跳过/回落后真正仍为 `queued` 时才入队面板（避免与 mid-turn 等待叠出「队列+输入框」）。
- Accept = **跟进消息已被唯一 prompt iterator 取走**（非模型答完；非 `streamInput()` 函数返回）。
- push 使用 `uuid = followUp.id`，interrupt 的 `still_queued` 可与 Eco 对账。
- 若 `still_queued` 含已知 push id：标记 `delivery_unknown`，不自动重发；该列表表示消息仍存活，不能证明未执行。
- 未映射 uuid：`delivery_unknown` 仅日志，**不** silent requeue。
- 实现：`apps/desktop/src/main/claude-mid-turn-port.ts` + `tryDeliverFollowUpViaMidTurn`。

## session cwd

```text
worktreePath.trim() || workspacePath.trim()
```

计划文件路径仍相对 **workspace** 规范化。

## Compact 权威路径

- **权威**：Claude Agent SDK `autoCompactEnabled` + `autoCompactWindow=min(模型窗口, 全局上限)`（进程内 local 摘要 + `compact_boundary`）。
- Eco 不调度 compact；屏蔽上游 `compact_20260112`。
- 1M 模型别名 `[1m]` 只在**有效窗口** ≥ 1M 时追加，避免全局上限 256k 时 SDK 仍按 1M 压缩。
- slash `/compact` 若仍存在于 SDK，不作为 Eco 产品入口。

## Codex 差异

- Codex mid-turn：主路径 regular turn 在 `turn/start` 拿到 turnId 后 open accepting port；
  纯文本 follow-up 经 **`turn/steer`**（`expectedTurnId` + `clientUserMessageId=followUp.id`）。
- Accept = app-server 入队成功（非模型读完）。附件 / 无 port / steer 失败 → `queued`→`resume`。
- **缺口（诚实）**：`turn/interrupt` 响应无 `still_queued`；中断后不 requeue mid-turn 条目（applied 保持）。
- Subagent spawn **不** 挂 mid-turn port（避免抢 parent eco 键）。Review/compact non-steerable → steer 失败回落 queue。

## 回归门禁

```bash
bun run test -- --claude-regression
```
