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
