# Claude Core baseline（streaming 地基）

本文记录 Eco 对 Claude Agent SDK（`@anthropic-ai/claude-agent-sdk` **0.3.223**）的接线约定。范围是 **Query 启动与生命周期地基**，不是产品级 mid-run 推送交付。

## 会话启动模型

- Thread 主路径（`run` / `runAsk` / `runPlan` / `runContinuation`）统一为 **streaming input 模式**：
  `sdk.query({ prompt: toStreamingUserPrompt(text), options })`。
- `toStreamingUserPrompt` 生成 **只 yield 一条用户消息后立即结束** 的 `AsyncIterable`。
  一 Eco-run ≈ 一轮 agent loop；续聊仍通过 **resume 新 query**，不是长开 multi-message Query。
- Slash 命令仍走同一条 streaming user message（逻辑 prompt 文本以 `/` 开头即可）；不单独保留 string prompt 热路径。
- Rewind 使用空内容 streaming prompt + `rewindFiles`；注释标明为 checkpoint 专用夹具。

## Query 生命周期

```text
create query (streaming single message)
  → consume iterator.next until end or AbortSignal wins
  → teardown:
      if aborted: interrupt（幂等；默认 2s，超时立即 close）
      有界 drain 已有 pending next 与残余 iterator（默认 2s）
      query.close()
      clear subagent runtime limits
```

- 正常结束与 abort 路径 **都会** `close`（不再依赖 iterator 自然结束后遗留 transport）。
- abort 上的 interrupt 与 finally teardown **共享** `interruptWork`，保证幂等。
- drain 超时后不等待可能排在 pending `next()` 后面的 `iterator.return()`；由 `query.close()` 强制释放 transport。
- Probe 相位：`interrupt` / `interrupt_error` / `interrupt_timeout` / `query_teardown`（含 `interrupt_ms`、`closed`、`still_queued`、`drain_*`）。

内部句柄 `ClaudeQueryHandle`（`open | closing | closed`）仅 runtime 私有，**不**作为产品 mid-run port 暴露。

## session cwd

统一为：

```text
worktreePath.trim() || workspacePath.trim()
```

`runSingleSession` 与 `rewindSessionFiles` 使用同一解析，避免 resume 根漂移。

## 产品交付语义（本阶段不变）

- Follow-up 仍为 **queue → run 结束后 resume drain**。
- 未接默认 mid-run `streamInput` 推送。
- Desktop continuation 仍要求 idle 后开新 query。

## 预留能力（段 B，未实现）

| 能力 | 状态 |
| --- | --- |
| `Query.streamInput` | 类型与 SDK handle 已对齐；**产品默认不调用** |
| 长开 multi-message Query / 默认 mid-run push | **未接**；需另计划 |
| Codex `turn/steer` | 不在本 baseline |

后续 mid-run 应挂在：**已有 live `ClaudeQueryHandle` + `streamInput`**，无需再改「一 Eco-run 一 streaming query」启动模型。

## Compact 权威路径

- **权威**：桌面 Eco compact handoff（清 Core session、写 handoff、下次 continuation 注入）。见 `docs/TECHNICAL.md`「上下文管理」。
- **旁路**：driver 仍可能支持用户 slash `/compact` 等 SDK 路径；文档与产品心智以 Eco compact 为准，勿把 slash 当作跨 Core 统一策略。

## 回归门禁

```bash
bun run test -- --claude-regression
```

关键断言点：streaming prompt 形态、abort 路径 **await interrupt + close**、resume/fork 选项保留、follow-up queue 语义不退化。
