# Claude mid-turn 跟进走同一条 held prompt stream

日期：2026-08-15  
状态：accepted  
相关：`docs/claude-core-baseline.md`；会话 `thr_1786776401044`；社区 [sdk-ts#348](https://github.com/anthropics/claude-agent-sdk-typescript/issues/348)、[#376](https://github.com/anthropics/claude-agent-sdk-typescript/issues/376)、[claude-code#4775](https://github.com/anthropics/claude-code/issues/4775)；Python 部分修复 [sdk-python#1103](https://github.com/anthropics/claude-agent-sdk-python/pull/1103)

## 问题

Claude Agent SDK（Eco 钉 `@anthropic-ai/claude-agent-sdk` **0.3.223**）的 `Query.streamInput()` 在输入 iterable **结束**且已经见过任意 `result` 之后调用 `transport.endInput()`，把 CLI stdin 关掉。之后所有 `can_use_tool` 被系统取消，JSONL 为 `toolDenialKind: "cancelled"`，工具结果文案却是 J3H「The user doesn't want to take this action right now…」。宿主 `canUseTool` 不会被调用，Eco 授权卡不会出现。

Eco 已对**首条** prompt 做 `holdOpenUntil`，避免第一次 `result` 关掉通道。但 mid-turn 跟进仍走**第二次、一次性** `query.streamInput(toStreamingUserPrompt(text))`。该 iterable 一结束，SDK 立刻 `endInput()`。注释「one-shot is fine once the initial hold is up」是错的。

实测：`hi`（首轮 result）→ 跟进「打开 huggingface」→ `Skill` / `WebFetch` 连续 `cancelled`。库内无任何 `bash_approval.requested`。

不能把 `holdOpenUntil` 直接套到第二次 `streamInput` 上：`pushUserMessage` 今天等到 **整次 `streamInput()` 返回** 才算交付成功；hold 住后这次 Promise 直到 teardown 才结束，会撞上 10s `streamInputDeadlineMs`，被标成 `delivery_unknown`。

## 目标

1. 一个 Eco-run 的 live Query **只使用一条** streaming 输入：`sdk.query({ prompt })` 内部那一次 `streamInput`。跟进往同一条 iterable 继续 yield，**禁止**再调 `query.streamInput()`。
2. 该 iterable 在 query teardown 之前不得 `done`。teardown 时再 close，让 SDK 这时才 `endInput()`。
3. `pushUserMessage` 的成功条件改为：跟进消息已被这条流的消费者取走（交给 SDK `streamInput` 的 `for await`），而不是 `streamInput()` 函数返回。超时 / 失败语义与现网一致（`ClaudeStreamInputFailed` + `deliveryUnknown`，不自动重发）。
4. 修正 `docs/claude-core-baseline.md` 与代码注释中的错误假设。

## 非目标

- 不等 TypeScript SDK 合入 Python #1103 那种 `endInput` 修复。
- 不给 Skill / WebFetch 增加 Eco 授权卡（通道修好后它们按现有 handler auto-allow，会真正执行）。
- 不用匹配 J3H 句子来把 `cancelled` 显示成「系统取消」——那是另一条 live 事件映射缺口，本 spec 不掩盖。
- 不改 Codex / PI mid-turn。
- 不改 rewind 路径（`toStreamingUserPrompt("")` 一次性空 prompt + `rewindFiles`，无跟进、无 `canUseTool` 通道需求）。

## 方案

采用 **held prompt mailbox**（社区与 SDK 文档的 streaming chat 模型）：

```text
createHeldPromptStream(initialText)
  → sdk.query({ prompt: stream })     // 唯一的 streamInput
  → 首条 yield 后阻塞在队列
  → pushUserMessage = stream.push()   // 不再 query.streamInput()
  → teardown: stream.close()          // iterable 结束 → SDK endInput → query.close()
```

### `createHeldPromptStream`

新类型（可与现有 `StreamingUserPrompt` 交叉）：

- `ecoPromptText`：仍为初始文本，供 `resolveSdkPromptCaptureText`。
- async iterator：先 yield 初始用户消息（可带 uuid）；然后从内部队列取后续消息 yield；`close()` 后结束。
- `push(text, options?: { uuid?: string })`：入队一条用户消息，**在该条被 iterator yield 给消费者之后** resolve。空文本拒绝。`close()` 之后 push 失败。并发 `push` 按 FIFO 入队。
- `close()`：幂等；唤醒等待中的 iterator / push。已入队未 yield 的消息：close 时视为未交付，未完成的 `push` reject（不假装成功）。

`toStreamingUserPrompt` 保留给 rewind / 一次性 prompt。Thread 主路径不再用 `holdOpenUntil` + 第二次 `streamInput`。

### `createClaudeQueryHandle.pushUserMessage`

- `createClaudeQueryHandle(query, { promptStream, streamInputDeadlineMs, onProbe })`：**thread 主路径必须传入** `promptStream`。`pushUserMessage` 只调用 `promptStream.push`，沿用 `streamInputDeadlineMs`（默认 `CLAUDE_QUERY_STREAM_INPUT_DEADLINE_MS`）。
- `phase !== "open"` 仍拒绝。
- 不再要求 `query.streamInput` 存在，也不再调用它。单元测试用 fake `HeldPromptStream`（可控 ack / hang），不要再 mock `query.streamInput` 来测 mid-turn。
- timeout：`push` 在截止时间内未 ack → 现有 `ClaudeStreamInputFailed`（`deliveryUnknown: true`）+ probe `stream_input_timeout`。
- 成功 probe 仍为 `stream_input_ok`（名称保留，避免 desktop 对账改名；语义是「已交给唯一那条 streamInput」）。

### Driver 生命周期

现有 `releasePromptHold()` 换成 `promptStream.close()`，仍在 `finally` 里、`onClosing` 之后、`query.close()` 之前，以便 inflight `push` 先被 mid-turn port 收口（`onClosing` 等 inflight），再 close mailbox。

顺序：

```text
onOpen(handle)
  consume iterator
onClosing(handle)    // port 拒新 push；await inflight push
promptStream.close() // 让唯一 streamInput 走完 endInput
teardown / query.close()
onClosed(handle)
```

### 交付语义（诚实缺口）

SDK 不暴露 `transport.write` 完成回调。ack = **iterator 已 yield 该条**，即 `streamInput` 的 `for await` 已拿到消息、即将 `write`。这比今天「等到 `streamInput()` 整段结束（含 `endInput`）」更早，但不再触发关通道。不能声称「已写入 stdin」；desktop 仍按现网：超时 = `delivery_unknown`，不自动重发。

## 测试

`packages/runtime/test/claude-agent-sdk.test.ts`：

1. `createHeldPromptStream`：yield 首条后不 `done`；`push` 后再 yield 该条；`close` 后 iterator 结束；close 后 push 失败。
2. Driver：mock `query({ prompt })` **只消费这一条** iterable；`pushUserMessage` 后跟进出现在同一 iterable；**`query.streamInput` 不得被调用**（若 mock 提供该函数，断言 0 次）。
3. 首条 `result` 之后再 push，iterable 在 close 前仍不 `done`（回归 #348 形状）。
4. 现有：uuid 跟进、phase closing 拒 push、timeout `deliveryUnknown`、onOpen 失败仍 teardown —— 改为走 mailbox，不断语义。

不在本 spec 加「J3H 文案 ⇒ cancelled」映射测试。

## 文档

更新 `docs/claude-core-baseline.md`：

- 删除「只 yield 一条后立即结束」+「后续经 `query.streamInput`」。
- 改为：live Query 的 prompt 是 held mailbox；同 run 跟进 `push` 进同一 iterable；teardown 才结束该 iterable。
- `pushUserMessage`：open 时 `HeldPromptStream.push` + 截止时间；成功 = 已 yield 给唯一 `streamInput`。

## 成功标准

复现 `hi` → mid-turn「打开 huggingface」→ `Skill` / `WebFetch`：**不再**出现 `toolDenialKind: "cancelled"` / J3H 用户拒绝文案。工具按 Eco handler 执行（Skill/WebFetch auto-allow）。
