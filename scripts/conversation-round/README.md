# Conversation round replay

End-to-end offline replay for one full agent turn (Codex / PI / Claude):

1. **Record** live upstream events (Codex JSON-RPC, PI session events, Claude SDK messages)
2. **Replay** through runtime adapters → `AgentEvent`
3. **(Codex only)** Persist to SQLite and incrementally materialize `thread_feed_skeleton`
4. **Assert** shared scenario checklist (skills, files, MCP, subagent, marker)

## Record (live)

### Codex (LongCat Responses API)

```bash
LONGCAT_API_KEY=... bun scripts/conversation-round/record.mjs
```

### PI π (LongCat OpenAI Chat Completions)

```bash
LONGCAT_API_KEY=... bun scripts/conversation-round/record-pi.mts
```

### Claude Agent SDK (LongCat Anthropic Messages)

```bash
LONGCAT_API_KEY=... bun scripts/conversation-round/record-claude.mts
```

Upstream: `https://api.longcat.chat/anthropic/v1/messages` (same key as Codex/PI).

### All cores

```bash
LONGCAT_API_KEY=... bun scripts/conversation-round/record-all.mjs
```

Env:

| Env | Default |
|---|---|
| `LONGCAT_API_KEY` | required for Codex + PI + Claude |
| `ECO_CODEX_SMOKE_BASE_URL` | `https://api.longcat.chat/openai/v1` |
| `ECO_CODEX_SMOKE_MODEL` | `LongCat-2.0` |
| `ECO_CLAUDE_SMOKE_BASE_URL` | `https://api.longcat.chat/anthropic` |
| `ECO_CLAUDE_SMOKE_MODEL` | `LongCat-2.0` |
| `ECO_CODEX_SMOKE_TIMEOUT_MS` | `600000` |

Artifacts:

```
scripts/conversation-round/fixtures/<runId>/           # Codex
  rpc-log.jsonl
  expected/thread-run-events.json
  ...

scripts/conversation-round/fixtures/<runId>-pi/        # PI
  pi-sdk-events.jsonl
  agent-events.jsonl
  workspace-files.json
  summary.json

scripts/conversation-round/fixtures/<runId>-claude/   # Claude
  sdk-messages.jsonl
  agent-events.jsonl
  workspace-files.json
  summary.json
```

## Replay (offline)

```bash
bun scripts/conversation-round/replay.mjs
bun scripts/conversation-round/replay.mjs --fixture=<runId>
bun scripts/conversation-round/replay.mjs --core=pi
bun scripts/conversation-round/replay.mjs --core=claude
bun scripts/conversation-round/replay.mjs --core=all
```

Runs:

- **codex**: `codex-scenario-smoke` checklist + `conversation-round-replay.test.ts`
- **pi/claude**: SDK checklist + `sdk-round-replay.test.ts`

## Scenario coverage

| Scenario | Codex evidence | PI / Claude evidence |
|---|---|---|
| Skills | `skills/list` | skill mount + `SMOKE_SKILL_OK` |
| File write | `smoke-note.txt` | workspace / write tool |
| File read | workspace content | read tool / content |
| MCP | `smoke_ping` | MCP proxy / `SMOKE_MCP_PONG` |
| Subagent | `collabAgentToolCall` | `agent.started` / Agent tool |
| Turn complete | `turn/completed` | `agent.settled` / marker |
| Feed skeleton | incremental ids | Codex replay only |

## Billing note

Codex billing ledger rows still originate from Gateway HTTP usage on live Desktop runs.
This harness replays adapter layers. Gateway ledger golden tests remain in
`apps/desktop/test/proxy-usage-billing.test.ts`.

## Tests only

```bash
ECO_CONVERSATION_ROUND_FIXTURE=scripts/conversation-round/fixtures/<runId> \
  bun test apps/desktop/test/conversation-round-replay.test.ts

ECO_SDK_ROUND_FIXTURE_PI=scripts/conversation-round/fixtures/<runId>-pi \
  bun test apps/desktop/test/sdk-round-replay.test.ts
```

Rebuild Codex expected artifacts:

```bash
bun scripts/conversation-round/build-expected.ts --fixture=<runId>
```
