# Eco Coding

Anthropic-compatible AI coding agent desktop app.

The first version focuses on a router-first command center:

- Claude Agent SDK runtime with native subagents. **Planner** orchestrates: plan (read-only + AskUserQuestion) → human approval → execute pipeline (Architect splits tasks when needed → parallel **Coder** → **Reviewer** → **Tester**). Subagents cannot nest; only the main Planner session spawns subagents.
- Anthropic-compatible model endpoints only.
- Worker-per-thread isolation.
- SQLite event storage with secrets kept in the system keychain.
- Git worktree based editing with diff approval before applying changes.

## System prompt and project context

Eco uses the Claude Agent SDK **`claude_code` preset** for the main Planner session. That preset is the same built-in coding system prompt Claude Code uses (tool usage, coding philosophy, safety, tone). Eco only **appends** product-specific rules on top: worktree isolation, plan/execute orchestration, and deliverable headings the UI parses.

Project conventions belong in **`CLAUDE.md`** (or `.claude/CLAUDE.md`) in the opened workspace, not in Eco's code. The runtime loads them automatically via `settingSources: ["user", "project"]`:

- **Project** — `CLAUDE.md` / `.claude/CLAUDE.md` in the workspace (including the isolated worktree cwd)
- **User** — `~/.claude/CLAUDE.md` for personal defaults

Optional: set `excludeDynamicSections: true` on `ClaudeAgentSdkDriver` if you need better prompt-cache reuse across threads with different worktree paths (trades slightly weaker in-system cwd emphasis for cache hits).

## Context compaction

Eco relies on the Claude Agent SDK’s built-in compaction during long sessions. When the context window nears its limit, the SDK summarizes older turns and emits a `compact_boundary` event; Eco updates the context meter and refreshes context breakdown via `getContextUsage()`.

Two layers work together:

1. **SDK auto-compaction** — runs inside the agent loop while a session is active (no extra setup).
2. **Eco preflight compaction** — before resuming a stored SDK session, if planner occupancy is at or above ~85% of the effective limit (catalog limit minus Claude Code’s autocompact buffer and output reserve), Eco runs `/compact` on a separate short-lived driver call so the next turn does not start on a full window. After a run ends, Eco may run the same step if the thread is still over threshold.

Persistent instructions that must survive compaction belong in **`CLAUDE.md`**, not only in the first user message, because compaction replaces early turns with a summary while `CLAUDE.md` is re-injected every request via `settingSources`.

Add a free-form section to your workspace `CLAUDE.md` telling the compactor what to keep, for example:

```markdown
# Summary instructions

When summarizing this conversation, always preserve:
- The current task objective and acceptance criteria
- File paths that have been read or modified
- Test results and error messages
- Decisions made and the reasoning behind them
```

Before each compaction, Eco’s **PreCompact** hook archives the thread activity log and context snapshot to SQLite (`thread_compaction_archives`) for audit and recovery.

## Subagent resume

Eco persists each subagent’s SDK `agentId` when it finishes (`SubagentStop`) and, on the next `Agent(role)` call in the **same Planner session**, automatically rewrites the tool input to `Resume agent {id} and …` (see [SDK subagent resume](https://code.claude.com/docs/en/agent-sdk/subagents#resuming-subagents)). This avoids re-reading the codebase on a second reviewer pass or after an interrupted explore/architect/coder run.

- **Planner session** must still be resumed (`sdk_session_id` on the thread); subagent transcripts live inside that session.
- **Parallel coders** are matched by coder todo id / mission text when possible; otherwise the latest stopped coder instance is resumed.
- **Force a fresh subagent** by including words like `fresh`, `restart`, or `从头开始` in the `Agent` prompt.

Subagent resume state is cleared when the SDK session is reset, routes change, or you start a **fresh plan**.

## Build & package

```bash
# Development
bun run dev

# Compile renderer + main + preload
bun run build

# Installers (run from repo root)
bun run pack:mac-arm64   # macOS Apple Silicon → apps/desktop/release/Eco-Coding-*-mac-arm64.dmg
bun run pack:win-x64     # Windows x64 NSIS → apps/desktop/release/Eco-Coding-*-win-x64.exe
```

macOS packages are unsigned by default (`identity: null` in `apps/desktop/electron-builder.yml`). For distribution, set a valid `CSC_NAME` / Developer ID and adjust signing in that file.

Windows installers can be built on macOS (electron-builder downloads the Windows Electron binary). The Claude Agent SDK native CLI for Windows is included via optional dependency `@anthropic-ai/claude-agent-sdk-win32-x64`.

## Repository shape

```txt
apps/
  desktop/        Electron and React desktop shell
packages/
  shared/         Shared schemas and event contracts
  runtime/        Thread worker lifecycle and agent runtime boundary
  agent/          Thread orchestration service
  model-router/   Anthropic-compatible endpoint routing and checks
  persistence/    SQLite and keychain ports
  workspace/      Git worktree and diff workflow
  approval/       Dangerous operation approval service
  terminal/       PTY session manager boundary
```
