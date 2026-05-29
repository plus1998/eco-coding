# Eco Coding

Anthropic-compatible AI coding agent desktop app.

The first version focuses on a router-first command center:

- Claude Agent SDK runtime with native subagents. **Planner** orchestrates: plan (read-only + AskUserQuestion) → human approval → execute pipeline (Architect splits tasks when needed → parallel **Coder** → **Reviewer** → **Tester**). Subagents cannot nest; only the main Planner session spawns subagents.
- Anthropic-compatible model endpoints only.
- Worker-per-thread isolation.
- SQLite event storage with secrets kept in the system keychain.
- Git worktree based editing with diff approval before applying changes.

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
