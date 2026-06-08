# Thread Live Follow-up V2 Spike

日期：2026-06-08

本报告对应 `docs/thread-live-follow-up-plan.md` 的阶段 6。结论只基于官方文档、本地安装的 SDK 类型和当前 Eco 代码；没有把未实测的 runtime 行为包装成已验证能力。

## 结论

V2 技术路线选择：使用 Claude Agent SDK `query({ prompt: AsyncIterable<SDKUserMessage>, options })` 的 streaming input 模式，Eco 自己维护 live input queue 和当前 `Query` handle。

不选择：

- 不使用旧 TypeScript V2 session API：官方文档标记为 removed，`@anthropic-ai/claude-agent-sdk@0.3.168` 已没有 `unstable_v2_createSession` / `SDKSession`。
- 不把 `runAssistantWorker` 作为默认主运行时：本地类型标记为 `@alpha`，且入口绑定 `ConnectRemoteControlOptions` / bridge / claude.ai remote control，更像 remote assistant daemon glue。它内部证明了 `pushPrompt()` 可以包装 streaming input，但 Eco 已有 Electron IPC、projection、billing 和 permission bridge，不应绕到 claude.ai bridge。
- 不在没有 authenticated live smoke 前进入 Phase 7：当前环境没有 `ANTHROPIC_API_KEY` / `CLAUDE_CODE_OAUTH_TOKEN` / `CLAUDE_API_KEY`，无法实测 `interrupt()` 对真实 Bash、Subagent、approval pending、partial usage 的副作用。

## 证据

### Codex 的对标能力

Codex App Server 是最接近“运行中追加消息并在合适边界引导”的公开能力。官方 manual / open-source README 描述了这些核心原语：

- `turn/start` 开始一个 turn。
- `turn/steer` 把用户输入追加到当前 in-flight turn，不创建新 turn。
- `turn/interrupt` 取消后仍以 `turn/completed` 结束。
- `expectedTurnId` 是 steer 的并发保护；active turn 不可 steer 或 turn id 不匹配时请求失败。

这说明 Codex 不是简单开第二个并发 run，而是在同一 active turn 上做受控 steering，并且协议层要求 turn id 匹配。

Codex app 的 Goal mode 也明确支持运行期间继续发送 follow-up steering，但 SDK/MCP 的公开 `thread.run()` / `codex-reply` 更接近下一轮 continuation，不等价于 same-turn steer。

来源：

- OpenAI Codex manual，本地通过 `fetch-codex-manual.mjs` 获取；相关源页：`https://developers.openai.com/codex/app-server`、`https://developers.openai.com/codex/app/commands`、`https://developers.openai.com/codex/sdk`
- OpenAI Codex open-source App Server README：`https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md`
- OpenAI App Server engineering post：`https://openai.com/index/unlocking-the-codex-harness/`

### Claude Agent SDK 的可行能力

官方 Claude Agent SDK TypeScript reference 和本地 `@anthropic-ai/claude-agent-sdk@0.3.168` 类型一致：

- `query()` 的 `prompt` 支持 `string | AsyncIterable<SDKUserMessage>`。
- `Query` 扩展 `AsyncGenerator<SDKMessage, void>`。
- streaming input 模式提供 `interrupt()`、`streamInput()`、`setPermissionMode()`、`setModel()`、`close()` 等控制方法。
- single message input 明确不支持 dynamic message queueing、real-time interruption、natural multi-turn conversations。
- streaming input 文档明确适合 long-lived interactive session、queued messages、interrupt、permission requests、session management。
- `SDKUserMessage` 支持文本和 content array；官方示例包含 image block，因此 V2 可支持运行中图片附件，但 Eco 需要把现有 `PromptImageAttachment` 转成 SDK content block。

本地类型还确认现有 Eco 依赖的能力在 streaming path 上仍存在：

- `tools` / `allowedTools` / `disallowedTools`
- `hooks`
- `canUseTool`
- `mcpServers`
- `systemPrompt`
- `agents`
- `sessionStore`
- `resume` / `resumeSessionAt` / `forkSession`
- `includePartialMessages`
- result usage fields：`total_cost_usd`、`modelUsage`

来源：

- Claude Agent SDK TypeScript reference：`https://code.claude.com/docs/en/agent-sdk/typescript`
- Streaming Input：`https://code.claude.com/docs/en/agent-sdk/streaming-vs-single-mode`
- Sessions：`https://code.claude.com/docs/en/agent-sdk/sessions`
- User input / approvals：`https://code.claude.com/docs/en/agent-sdk/user-input`
- Subagents：`https://code.claude.com/docs/en/agent-sdk/subagents`
- Cost tracking：`https://code.claude.com/docs/en/agent-sdk/cost-tracking`
- Removed TypeScript V2 session API：`https://code.claude.com/docs/en/agent-sdk/typescript-v2-preview`
- Local SDK: `node_modules/@anthropic-ai/claude-agent-sdk/package.json` version `0.3.168`, `claudeCodeVersion` `2.1.168`

## 对当前 Eco 的影响

当前 Eco 主运行时在 `packages/runtime/src/claude-agent-sdk.ts` 中调用：

```ts
const query = sdk.query({
  prompt: phase.prompt,
  options: queryOptions,
});
```

这仍是 single message input 形态。Phase 1-5 的 V1 queue 是正确的，因为当前运行中的用户消息不会进入 active SDK query。

Phase 7 需要改成：

1. 为每个主 run 创建 `LiveInputController`。
2. controller 暴露 `AsyncIterable<SDKUserMessage>`，启动时先 yield 初始 `phase.prompt`。
3. `activeRunRuntimeState` 保存 `{ query, liveInputController, sdkSessionId, runAttemptId }`。
4. 普通 follow-up：
   - 持久化 pending follow-up。
   - 如果 active handle 可用，把 message push 到 controller。
   - 标记 delivery mode `streaming_push`，并在 SDK stream 出现后转 `delivered/applied`。
   - 如果 push 失败，保持 V1 queued，不丢消息。
5. 强制提升：
   - 持久化 escalated follow-up。
   - 优先调用 `query.interrupt()`。
   - interrupt 成功后 push 最新消息或走 resume continuation。
   - interrupt 失败才走 Eco 现有 abort + resume。
6. `consumeSdkRunEvents` 可以继续消费同一个 `for await (const message of query)`；billing / projection 不应另开通道。

## 必须保留的 V1 边界

即使 Phase 7 接入 streaming input，也必须保留 V1 queue：

- app 重启后 live handle 不存在，只能走 queued resume。
- SDK push/interrupt 抛错时，pending follow-up 不能丢。
- 当前 active turn 不可 steer / SDK streaming input 不可用时，UI 必须显示 queued。
- forced interrupt 后无法 resume 时必须显式 failed/blocked，不允许 fresh start 冒充恢复。

## 未完成的真实运行验证

本阶段没有完成 authenticated live smoke，原因是当前环境没有可用 Claude 凭据：

- `ANTHROPIC_API_KEY`: unset
- `CLAUDE_CODE_OAUTH_TOKEN`: unset
- `CLAUDE_API_KEY`: unset

因此这些行为仍不能声明为已验证：

- `interrupt()` 正在执行 Bash 时，是等待 Bash 结束、发送中断信号、还是只中断后续模型 turn。
- `interrupt()` 对前台 subagent / background subagent 的传播语义。
- pending `canUseTool` / `AskUserQuestion` callback 期间调用 `interrupt()` 的返回顺序和 stream 事件。
- partial usage 在 interrupt 前后的 result message 是否总是可得，以及是否与 Eco 当前 interrupted settlement 对齐。

Phase 7 开始前必须先做一个 authenticated smoke：

1. streaming input 初始 prompt：要求执行一个短 Bash 或只读工具。
2. 在工具执行中 push 普通 follow-up，确认消息在同一 query stream 内被读取。
3. 在工具执行中调用 `interrupt()`，确认 result subtype、usage、partial events、cleanup 顺序。
4. 用 `canUseTool` 人为挂起 Bash approval，调用 `interrupt()`，确认 callback signal / query 结束顺序。
5. 启动一个自定义 subagent，调用 `interrupt()`，确认 subagent event 和 parent result 的状态。

没有这组 smoke，不允许把 Phase 7 的 delivery mode 默认切到 `streaming_push`。

## 本阶段新增可重复验证

新增离线测试：

- `apps/desktop/test/thread-live-follow-up-v2-sdk-surface.test.ts`

它不连 Claude、不消耗 Token，只验证当前安装的 SDK package/type surface 是否仍包含 Phase 7 所需入口：

- streaming prompt
- Query interrupt / streamInput / close
- resume / resumeSessionAt / forkSession / sessionStore
- hooks / MCP / systemPrompt / agents
- usage result fields
- assistant worker alpha pushPrompt/interrupt surface

这不是 runtime smoke；它的作用是防止后续升级 SDK 时悄悄删掉或改名关键入口。

## Phase 7 Gate

Phase 7 的进入条件：

- `thread-live-follow-up-v2-sdk-surface.test.ts` 通过。
- authenticated live smoke 通过并记录结果。
- 设计中明确 active run handle 生命周期：创建、push、interrupt、close、cleanup、app crash 后恢复。
- UI 文案仍区分 `queued` 与 `streaming_push delivered`。
- billing / usage / projection / subagent metrics 的现有测试不回退。

当前状态：V2 技术路线可以确定，但 Phase 7 仍被 authenticated live smoke 阻塞。
