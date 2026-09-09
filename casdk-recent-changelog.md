## 0.3.266

- Updated to parity with Claude Code v2.1.266

## 0.3.265

- Added `user_message_uuid` and `user_message_uuids` to a synthetic turn's first reply and result for a message sent with `isSynthetic: true` and a `uuid`, naming the message that started it
- Added `user_message_uuid` and `user_message_uuids` to the first reply and the result of a turn Claude Code started itself, such as a resume, naming the messages you sent that it picked up mid-turn
- Fixed `user_message_uuid` missing from the success result of a turn that sent no API request, such as a slash command
- Fixed multi-turn sessions resetting the shell working directory to the `cwd` option at each new user message; a `cd` made by the agent now persists across turns, as in the interactive app
- Changed `user_message_uuid` to be set on the first reply after each change of the message a turn is answering, instead of on one reply frame per turn
- Updated to parity with Claude Code v2.1.265

## 0.3.264

- Updated to parity with Claude Code v2.1.264

## 0.3.263

- Updated to parity with Claude Code v2.1.263

## 0.3.262

- Updated to parity with Claude Code v2.1.262

## 0.3.261

- Added `pluginDelivery: 'initialize'` to send `plugins` over stdin so the launch command line no longer grows with the plugin count (fixes Windows start failures with many plugins)
- Fixed `query()` throwing "Object not disposable" in runtimes without a native `Symbol.dispose`, such as Node ≤22 `vm` contexts (Jest's `node` environment, vitest `vmThreads`/`vmForks`) and Node <18.18
- Updated to parity with Claude Code v2.1.261

## 0.3.260

- Added optional `user_message_uuid` to `thinking_tokens` system messages, linking thinking progress to the user message that triggered the turn
- Added optional `first_content_frame_ms`, `first_stream_post_ms`, `first_stream_post_ack_ms` and `first_stream_post_wall_ms` fields to the success result message for remote-session latency breakdowns
- Fixed `managedSettings` `disableAutoMode: "disable"` (either spelling) being dropped by the restrictive-only filter instead of turning auto mode off for the spawned session
- Fixed `rewindFiles()` reporting success when no files could be restored (for example when checkpoint backups are missing); it now fails
- Changed `error_max_structured_output_retries` results to append the last StructuredOutput tool error; validation errors now name the offending key, allowed values, and actual length or count
- Changed `rate_limit_event` to also re-emit during an exceeded window on repeat 429s (about once per 30 seconds per limit window), so stream consumers can refresh stale rate-limit state
- Updated to parity with Claude Code v2.1.260

## 0.3.259

- Added `user_message_uuids` beside `user_message_uuid` on a turn's first reply frame and result: every user message the turn answered, so a reply to several merged messages can be matched to each
- Added `permissionPrompts: 'none'` option to auto-deny permission prompts in sessions with nobody to answer them, without disabling auto mode's classifier
- Updated to parity with Claude Code v2.1.259

## 0.3.258

- Updated to parity with Claude Code v2.1.258

## 0.3.257

- Added `thinkingTokens` to `ModelUsage` (a subset of `outputTokens`), and fixed result-message `usage.output_tokens_details.thinking_tokens` reporting 0 instead of the session's real count
- Added `tool_use_result.resourceLinks` on user messages carrying MCP tool results: the `resource_link` blocks the tool returned, so hosts can render returned files without parsing the result text
- Added optional `resource_links` to `task_notification` for an auto-backgrounded MCP tool call that completed, listing the files it returned by reference; join to the call via `tool_use_id`
- Fixed `mcp_reconnect` and `mcp_toggle` acting on a same-named `.mcp.json` / `~/.claude.json` server instead of the `--mcp-config` or `mcp_set_servers` one
- Fixed `mcp_toggle` disable also removing the tools of a sibling MCP server whose name extends the disabled one's (disabling `foo` dropped `foo__bar`'s tools)
- Changed `mcp_set_servers` to also list a server whose connection attempt throws under `added` (with a `failed` row in `mcp_status`), not only under `errors`
- Changed Agent tool calls to emit the periodic `tool_progress` heartbeat (`heartbeat: true`) like other long tools; heartbeat frames never clear a `subagent_retry` indicator
- Fixed the browser SDK bundle (`@anthropic-ai/claude-agent-sdk/browser`) never streaming any messages on engines without native `Symbol.dispose` (Safari/iOS, Firefox ESR, older Chromium)
- Fixed a background Bash task that is still running when a stream-json session ends right after an interrupt (stdin closed) never receiving its final `task_notification`
- Fixed `-p` giving up on a long-running background subagent without actually stopping it, so `background_tasks_changed` kept listing it and events for it arrived after its `stopped` notification
- Added `detail` option to `Query.getContextUsage()`: `'summary'` answers from the last response's usage and local estimates without per-category token-count API calls (default `'full'`)
- Updated to parity with Claude Code v2.1.257

## 0.3.256

- Updated to parity with Claude Code v2.1.256

## 0.3.255

- Updated to parity with Claude Code v2.1.255

## 0.3.254

- Updated to parity with Claude Code v2.1.254

## 0.3.253

- Updated to parity with Claude Code v2.1.253

## 0.3.252

- Updated to parity with Claude Code v2.1.252

## 0.3.251

- Updated to parity with Claude Code v2.1.251

## 0.3.250

- Updated to parity with Claude Code v2.1.250

## 0.3.249

- Updated to parity with Claude Code v2.1.249

## 0.3.248

- Added a per-server `timeout` for SDK-hosted MCP servers (`createSdkMcpServer({ timeout })`), overriding `MCP_TOOL_TIMEOUT` for that server's tool calls

## 0.3.247

- Added an optional `ambient` flag to `task_started`, `task_notification` and `background_tasks_changed` task entries so hosts can exclude housekeeping tasks from activity indicators
- Fixed the `permissionMode` on per-turn `system/init` frames reporting the mode at turn start instead of the live mode, so a mode switch right after submitting no longer sends a stale value

## 0.3.246

- Added optional `user_message_uuid` to error result messages and to the first assistant message or `stream_event` of each turn, linking a reply or failure to the user message that triggered it
- Added `modelUsage[*].costBasis` (`'list' | 'managed' | 'unknown'`) reporting which price table each model's `costUSD` was computed from
- Added `modelPricing` support in the `managedSettings` option for hosts that set `CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST`; an admin-managed settings source that sets `modelPricing` still wins
- Added `perTaskStopAffordance` option: when set, `interrupt()` aborts only the current turn and keeps background agents and workflows running; otherwise (and for one-shot string prompts) they stop

## 0.3.245

- Updated to parity with Claude Code v2.1.245

## 0.3.244

- Updated to parity with Claude Code v2.1.244

## 0.3.243

- Added optional `queued_turn_count` to result messages: the number of queued user sends still pending when the result was produced, so hosts know whether another turn and result will follow
- Fixed `mcp_status` reporting a remote MCP server as connected after its connection dropped; it now reports pending while reconnecting, then connected or failed
- Fixed managed `disableAllHooks` also disabling hook callbacks registered through the `hooks` option; they now keep running, matching `allowManagedHooksOnly`
- Changed Read tool PDF results: the `document` block (or page `image` blocks for `pages` reads) now arrives inside the `tool_result` content instead of as a separate `user` message after it
- Updated to parity with Claude Code v2.1.243

## 0.3.242

- Updated to parity with Claude Code v2.1.242

## 0.3.241

- Updated to parity with Claude Code v2.1.241

## 0.3.240

- Updated to parity with Claude Code v2.1.240

## 0.3.239

- `total_cost_usd` / `modelUsage.costUSD` now include the 1.1× US-only-inference (data residency) multiplier when the response reports `inference_geo: "us"`
- A result held back for background subagents in one-shot mode now reports `total_cost_usd`, `duration_api_ms` and `modelUsage` as of its release, not the turn-end snapshot
- Fixed `SYSTEM_PROMPT_DYNAMIC_BOUNDARY` in an array `systemPrompt` being sent to the model as literal text on Bedrock, Vertex, Foundry, and gateway providers
- A repeated `initialize` on a running process is now followed by a `background_tasks_changed` snapshot of the live background tasks, so reconnecting hosts see work that is still running

## 0.3.238

- Added `is_backgrounded` and `spawn_depth` to `task_started` events for subagent tasks (`is_backgrounded` also on background Bash tasks)
- Added `suppressOriginalPrompt` to `UserPromptExpansion` hook output, matching `UserPromptSubmit`
- Added `command_lifecycle` state `refused`: a cross-session peer message the session's receive-side policy declines now reports this terminal state instead of producing no lifecycle frames
- Fixed SDK hook callbacks silently not applying after a host re-sends `initialize` to an already-running CLI; the response now reports `hooks_applied`
- Fixed `CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION=true` not keeping `prompt_suggestion` messages on when the account is near, but not over, its usage limit
- Changed `vcs_state_changed` push events to emit one event per pushed branch

## 0.3.237

- Updated to parity with Claude Code v2.1.237

## 0.3.236

- `PostToolUse` hooks can return `hookSpecificOutput.classifierContext`, a short host-asserted note about a tool call's result that the auto mode permission classifier reads alongside that result

## 0.3.235

- Updated to parity with Claude Code v2.1.235

## 0.3.234

- Removed unused `bypass_permissions_disabled` from `ExitReason` type; the value was never emitted — TypeScript consumers with an explicit `case` branch get a compile error on upgrade (runtime unaffected)
- Updated the `ApiKeySource` type to include the values `system/init` actually reports (`ANTHROPIC_API_KEY`, `apiKeyHelper`, `/login managed key`, `none`)
- `vcs_state_changed` events report the directory the shell finished in (an inner `cd` is reflected)
- A peer `origin` injected by the host may declare the sending session's permission class (`fromMode`) so a same-class message is delivered to a recipient that runs without asking
- `SDKSystemMessage` (`system`/`init`) gains an optional `effort` field: the session's applied effort level, or `null` when none is sent. Set on Remote Control bridge init frames

## 0.3.233

- Notification hooks now fire for pending permission prompts on the SDK path, matching the interactive REPL behavior
- Todo/task-tracking tools (`TaskCreate`/`TaskGet`/`TaskUpdate`/`TaskList`, `TodoWrite`) are no longer in the default tool surface on Opus 4.8, Sonnet 5, Fable 5, Mythos 5, and newer models; name them in the `tools` option or reference them in `allowedTools` (or set `CLAUDE_CODE_ENABLE_TODO_TOOLS=1`) to keep them

## 0.3.232

- Subagent MCP `tool_result` frames whose result carries `_meta` now emit `tool_use_result` as `{ content, _meta }` (matching main-loop frames) instead of a bare value
- `/context` result messages now carry a structured `context_usage` payload (new `SDKContextUsage` type), so consumers can render the context-usage card without parsing the markdown table
- `vcs_state_changed` events now populate the `branch` field for push operations, sourced from the pushed ref

## 0.3.231

- Updated to parity with Claude Code v2.1.231

## 0.3.230

- Updated to parity with Claude Code v2.1.230

## 0.3.229

- Added `terminal_slash_commands` to the system init message so Remote Control clients can hide terminal-oriented commands
- Changed conversations whose messages alone exceed the API's 32 MB limit to end the turn with `terminal_reason` `"api_error"` instead of `"image_error"`; `StopFailure` `error_details` is `"request_body_over_limit: …"`

## 0.3.228

- Agent tool results (`AgentOutput`): `usage.output_tokens_details` is now carried through

## 0.3.227

- Updated to parity with Claude Code v2.1.227

## 0.3.226

- Updated to parity with Claude Code v2.1.226

## 0.3.225

- Fixed background subagents in headless/SDK sessions never resuming when a background shell command or Monitor they left running completed, so the subagent never saw the result

## 0.3.224

- Added `crossSessionInbound` and `dialogExpiry` settings: cross-session messages sent to a session running with bypassed permissions are held for your approval, and messages to other sessions auto-deliver
- Added `subkind: 'peer-send-message'` to the `task-notification` member of `SDKMessageOrigin`, marking a notification raised by a cross-session `SendMessage`
- Added `source: 'archive'` plugin config variant to `Settings`, with `url` and optional `sha256`, for installing plugins from a zip over HTTPS
- Added sandbox credential-masking fields to `Settings`: `decode: 'jwt'` with `maskClaims`, `extract`/`onExtractNoMatch` on `envVars`, and `awsPairs`/`sigv4` for AWS SigV4 re-signing
- Fixed long (>200 char) project paths resolving to another project's session directory under a shared sanitized prefix; session list/get/rename/tag/fork/delete and `/resume` no longer cross projects

