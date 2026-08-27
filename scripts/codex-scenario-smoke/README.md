# Codex scenario smoke + replay

Reusable live smoke against a Responses-compatible provider (default: LongCat), recording raw app-server JSON-RPC traffic for offline replay.

## Record (live)

```bash
# Windows PowerShell
$env:LONGCAT_API_KEY="ak_..."
bun scripts/codex-scenario-smoke/run.mjs
```

Optional env:

| Env | Default |
|---|---|
| `ECO_CODEX_SMOKE_BASE_URL` | `https://api.longcat.chat/openai/v1` (Codex appends `/responses`) |
| `ECO_CODEX_SMOKE_MODEL` | `LongCat-2.0` |
| `ECO_CODEX_SMOKE_TIMEOUT_MS` | `600000` |
| `ECO_SMOKE_MARKER` | auto |

Artifacts land in `scripts/codex-scenario-smoke/fixtures/<runId>/`:

- `rpc-log.jsonl` — every notification / client result / server request (API key redacted)
- `skills-list.json` — raw `skills/list`
- `thread-read.json` — thread snapshot after turn
- `workspace-files.json` — workspace file contents after turn
- `summary.json` — checklist + observed methods/itemTypes
- `prompt.txt` — exact user prompt
- `codex-stderr.log` — app-server stderr

`fixtures/latest.json` always points at the newest run.

## Replay (offline, no network)

```bash
bun scripts/codex-scenario-smoke/replay.mjs
bun scripts/codex-scenario-smoke/replay.mjs --fixture=<runId>
```

Replay re-evaluates the checklist from the recorded `rpc-log.jsonl` and fails if a previously-green scenario is broken by assertion logic changes, or if the fixture is structurally incomplete.

## Checklist coverage

1. skills listed (`skills/list`)
2. skill used / mentioned (`SMOKE_SKILL_OK`)
3. file write (`smoke-note.txt`)
4. file read-back
5. MCP tool call (`eco_smoke` / `smoke_ping`)
6. subagent spawn (`smoke_worker`)
7. subagent lifecycle evidence
8. `turn/completed`
9. final marker `SMOKE_DONE:<marker>`

## Notes

- Never commit API keys. Fixtures redact `LONGCAT_API_KEY`.
- Live run uses `approval_policy=never` + `danger-full-access` so the scenario can finish unattended.
- MCP checklist requires a **native** `mcpToolCall` for `smoke_ping` / `smoke_echo`. Prose or shell that prints `SMOKE_MCP_*` does **not** count.
- If a checklist item fails, inspect `rpc-log.jsonl` item types — models may name tools differently; extend `assert.mjs` rather than loosening silently.

## MCP handshake (community findings)

Symptom we hit: `MCP startup failed: timed out handshaking with MCP server after ~60s`.

Root causes confirmed in community + local probe:

1. **Framing**: Codex stdio MCP client speaks **NDJSON** (`JSON\n`), not LSP `Content-Length` framing. Servers that only speak Content-Length never answer `initialize` → timeout.
   - [youtube-studio-mcp#1](https://github.com/i1s-abhishek/youtube-studio-mcp/pull/1)
   - [openai/codex#14933](https://github.com/openai/codex/issues/14933)
2. **Windows spawn**: pin absolute `node.exe` in `config.toml` (`command = "C:/Program Files/nodejs/node.exe"`). Relying on PATH / launching via `bun` is fragile.
   - [openai/codex#18486](https://github.com/openai/codex/issues/18486)
3. **stdout purity**: only JSON-RPC on stdout; logs go to file via `ECO_SMOKE_MCP_LOG` (or stderr). Non-JSON on stdout closes the transport.

Focused probe (no model / no API key):

```bash
bun scripts/codex-scenario-smoke/probe-mcp-handshake.mjs
```

Expect `mcpServer/startupStatus/updated` → `status: "ready"` and `mcpServerStatus/list` showing `eco_smoke` tools.
