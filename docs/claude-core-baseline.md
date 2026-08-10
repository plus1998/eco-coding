# Claude Core baseline（streaming 地基 + mid-turn）

本文记录 Eco 对 Claude Agent SDK（`@anthropic-ai/claude-agent-sdk` **0.3.223**）的接线约定：
Query 启动 / 生命周期地基，以及产品级 **mid-turn `streamInput` 注入**。

## 会话启动模型

- Thread 主路径（`run` / `runAsk` / `runPlan` / `runContinuation`）统一为 **streaming input 模式**：
  `sdk.query({ prompt: toStreamingUserPrompt(text), options })`。
- `toStreamingUserPrompt` 生成 **只 yield 一条用户消息后立即结束** 的 `AsyncIterable`。
  一 Eco-run 仍是一个 live `Query`；**同 run 内**后续用户文本经 `query.streamInput(toStreamingUserPrompt(...))` 注入，不是再开 string query。
- Slash 命令仍走同一条 streaming user message。
- Rewind 使用空内容 streaming prompt + `rewindFiles`。

## Query 生命周期

```text
create query (streaming single message)
  → onOpen(handle)  // desktop mid-turn port = accepting
  → consume iterator until end or AbortSignal
  → onClosing(handle)  // port rejects new push; await inflight
  → teardown:
      if aborted: interrupt（幂等；still_queued 供调和）
      有界 drain
      query.close()
  → onClosed(handle, { stillQueued })
```

- 正常结束与 abort 路径 **都会** `close`。
- `ClaudeQueryHandle.pushUserMessage`：仅 `phase === "open"` 时调用 `streamInput`；带截止时间；失败抛错。
- Probe：`stream_input_ok` / `stream_input_error` / `stream_input_timeout` / `interrupt*` / `query_teardown`。

## Mid-turn 产品交付（Desktop）

| 条件 | deliveryMode | 行为 |
| --- | --- | --- |
| Claude + 纯文本 + port accepting + streamInput 成功 | `streaming_push` | 已注入当前 Query；status=`applied` |
| 附件 / 无 port / 明确拒绝 / 非 Claude | `queued` → 结束后 `resume` | 现网 queue drain |
| push 超时 / 传输断连 | `streaming_push` + `failed` | 交付状态未知；不自动重发 |
| escalated 且 push 失败 | `interrupt_resume` | abort + force drain |

- Accept = **SDK `streamInput` 成功**（非模型答完）。
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

- **权威**：桌面 Eco compact handoff。
- slash `/compact` 为旁路，不代替跨 Core 策略。

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
