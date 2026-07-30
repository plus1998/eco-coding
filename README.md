# Eco Coding

Anthropic-compatible AI coding agent desktop app.

The first version focuses on a router-first command center:

- Claude Agent SDK runtime with native subagents. The **main agent** orchestrates work in a single SDK session: in Agent mode it may edit directly, delegate to Eco subagents when their **description** fits, and call `AskUserQuestion` when a user decision is required. Formal planning through **`ExitPlanMode`** is available only in Plan mode. There is **no fixed** explore → architect → coder → reviewer → tester pipeline. Subagents cannot nest; only the main session spawns subagents.
- Anthropic-compatible model endpoints only.
- Worker-per-thread isolation.
- SQLite event storage with secrets kept in the system keychain.
- Direct workspace editing with SDK file checkpointing for rewind; session diffs tracked via git in the opened project.

## Thread modes (Composer `sessionMode`)

Users pick the mode explicitly in Composer — **Agent | Plan | Ask**. Eco does **not** infer Q&A from prompt wording (`classifyThreadIntent` removed).

| Mode | When | Runtime entry | SDK `permissionMode` |
|------|------|---------------|----------------------|
| **Agent** (default) | Coding / implementation | `driver.run()` or execution continuation | `acceptEdits` |
| **Plan** | User wants plan-first workflow | `runContinuation("planning")` | `plan` (official Claude Plan Mode) |
| **Ask** | Read-only Q&A | `driver.runAsk()` or `runContinuation("ask")` | `dontAsk` + read-only `allowedTools` |

`sessionMode` is stored on the thread (`thread.runtimeConfig.sessionMode`) and on workflow defaults (`agent` | `plan` | `ask`).

**Agent** keeps `AskUserQuestion` available but explicitly disables `EnterPlanMode` and `ExitPlanMode`. **Plan** changes continuation routing, enables SDK Plan Mode on planning turns, and submits through `ExitPlanMode`.

Plan approval uses the **ExitPlanMode bridge**: hooks capture the plan, Eco shows the approval UI, and execution continues in the **same SDK session** after approval.

**Ask** is not auto-selected for question-shaped messages in Agent mode — switch Composer to Ask for read-only answers.

See **[docs/session-mode-simplification.md](docs/session-mode-simplification.md)** for the migration plan and **[docs/agent-sdk-tools-and-permissions.md](docs/agent-sdk-tools-and-permissions.md)** for tools/permissions per mode.

## System prompt and project context

Eco uses the Claude Agent SDK **`claude_code` preset** unchanged for the main session. Codex likewise keeps its official preset. Eco does not append hard-coded mode explanations, orchestration rules, tool advice, role rosters, or coding guidance.

The main-agent prompt contract is UI-only:

- append `mainAgent.prompt` only when the user selects the custom-append preset and provides text;
- append `strategy.guidancePrompt` only when the user configures it in the orchestration UI;
- append V4A teaching only when the user explicitly enables that option;
- register only subagent definitions enabled by the user; without an agent registry, do not invent fallback Eco agents.

Runtime state such as an approved plan, follow-up message, compact summary, changed-file list, or image-analysis report may still be sent as data needed to continue the task. Those payloads must not add Eco-authored behavioral instructions.

Project conventions belong in **`CLAUDE.md`** (or `.claude/CLAUDE.md`) in the opened workspace, not in Eco's code. The runtime loads them automatically via `settingSources: ["user", "project"]`:

- **Project** — `CLAUDE.md` / `.claude/CLAUDE.md` in the workspace cwd
- **User** — `~/.claude/CLAUDE.md` for personal defaults

Optional: set `excludeDynamicSections: true` on `ClaudeAgentSdkDriver` if you need better prompt-cache reuse across threads (trades slightly weaker in-system cwd emphasis for cache hits).

## Prompt architecture

The SDK receives an official preset, optional user-configured append text, and optional UI-enabled subagent definitions.

### Main agent system prompt (every session)

Built in `runSingleSession()` (`packages/runtime/src/claude-agent-sdk.ts`):

```txt
claude_code preset (SDK built-in)
  + mainAgent.prompt             # only custom_append text entered in UI
  + strategy.guidancePrompt      # only text configured in UI
```

Session behavior is expressed structurally through `permissionMode`, `allowedTools`, `disallowedTools`, registered `agents`, SDK settings, and hooks. Tool denials report only the failed policy fact; they do not teach the model what to do next.

### User-turn prompts (not system)

| Mode | Prompt | Notes |
|------|--------|-------|
| Agent | Raw user message | No Eco behavior wrapper |
| Plan continuation | Raw user message | Plan behavior comes from official Plan Mode |
| After plan approval | Approved plan/follow-up data when required | Same-session resume uses only the follow-up or a minimal continuation command |
| Ask | Raw user message | No `buildQuestionAnswerPrompt` wrapper |

### Eco coding subagents (`createAutonomousAgentDefinitions`)

Subagent **description** (routing hint for the main agent) and **prompt** (subagent system instructions) live in `packages/runtime/src/prompts/`:

| Role | Description | Prompt module | Tools (summary) |
|------|-------------|---------------|-----------------|
| **explore** | Read-only discovery | `explore.ts` | Read, Glob, Grep |
| **architect** | Optional parallel task breakdown | `execution-agents.ts` (`executionArchitect*`) | Read + network |
| **coder** | Focused implementation | `execution-agents.ts` (`executionCoder*`) | Read/write + Bash |
| **reviewer** | High-risk review only | `execution-agents.ts` (`reviewerAgentPrompt`) | Read + Bash + network |
| **tester** | Narrow verification | `execution-agents.ts` (`executionTester*`) | Read + Bash + network |

Subagent prompt text comes from the template selected and enabled in the orchestration UI (`agent-orchestration.ts` → `template.prompt`). Live sessions without that UI registry do not register the hard-coded legacy coding roster.

### Runtime injection (hooks, not system append)

- **ExitPlanMode** — captured in hooks; desktop `awaitPlanApproval` shows plan UI; `plan.ready` event for transcript fallback
- **Reviewer scope** — changed-file data attached to reviewer delegations
- **Subagent handoff** — task, summary, and recent-output data needed to resume compacted work
- **Tool policy** — PreToolUse denies disallowed tools with a factual reason

### Deprecated aliases

- `createAgentDefinitions` — alias of `createAutonomousAgentDefinitions`
- Forced execute-phase pipeline prompts (`buildExecutePhase*`, `planningPhaseSystemAppend`, etc.) — **removed**

## Context compaction

Eco relies on the Claude Agent SDK’s built-in compaction during long sessions. When the context window nears its limit, the SDK summarizes older turns and emits a `compact_boundary` event.

Context meter updates use two tracks (Claude Code / Agent SDK style):

1. **During a turn** — `message_delta` stream usage (`stream_partial`) keeps the meter live; subagent sessions also refresh from proxy usage.
2. **At each turn end** — SDK `getContextUsage()` (same data as `/context`) calibrates planner occupancy and segment breakdown once per agent `result`, including after `/compact`. SDK `result.usage` is billing-only and does not drive the meter.

Eco does not poll `getContextUsage()` on a background timer.

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

### SDK vs Eco fallback compaction

Eco uses two compaction paths:

1. **SDK `/compact`** — when the upstream model exposes the `compact` slash command (native Claude / Claude Code routes). Behavior is unchanged: the SDK summarizes in-session and emits `compact_boundary`.
2. **Eco fallback** — when `/compact` is unavailable (typical for OpenAI-compat / llama-server routes). Eco:
   - archives context (same as PreCompact for manual; explicit archive for auto),
   - splits `thread_activity` user lines: **LLM summary of older messages** + **last ~20k tokens of user messages kept verbatim**,
   - stores the result in `thread_compact_handoff`, then **`clearSdkSession`** (including subagent sessions),
   - on the next continue, injects a handoff prompt and starts a **fresh SDK session**; handoff is cleared after `session.captured`.

v1 Eco fallback summarizes from `thread_activity` only (600-char line cap, no raw tool transcripts), so it is lossier than SDK `/compact` but sufficient for non-Claude routes.

After Eco fallback compaction, **subagent resume is reset** because subagent session state is cleared with the planner SDK session.

## Subagent resume

Eco persists each subagent’s SDK `agentId` when it finishes (`SubagentStop`) and, on the next `Agent(role)` call in the **same Planner session**, automatically rewrites the tool input to `Resume agent {id} and …` (see [SDK subagent resume](https://code.claude.com/docs/en/agent-sdk/subagents#resuming-subagents)). This avoids re-reading the codebase on a second reviewer pass or after an interrupted explore/architect/coder run.

- **Planner session** must still be resumed (`sdk_session_id` on the thread); subagent transcripts live inside that session.
- **Parallel coders** are matched by coder todo id / mission text when possible; otherwise the latest stopped coder instance is resumed.
- **Force a fresh subagent** by including words like `fresh`, `restart`, or `从头开始` in the `Agent` prompt.

Subagent resume state is cleared when the SDK session is reset, routes change, or you start a **fresh plan**.

## Agent SDK tools and permissions

Eco sits on top of the Claude Agent SDK’s two-layer tool model (availability vs permission). Orchestration tool policy, Bash review mode, Plan mode, and `allowedTools` are easy to confuse.

See **[docs/agent-sdk-tools-and-permissions.md](docs/agent-sdk-tools-and-permissions.md)** for:

- How Eco maps `tools` / `disallowedTools` / `allowedTools` / `permissionMode` / `canUseTool`
- Plan mode two-turn workflow and `ExitPlanMode` pitfalls
- Product rule: **if a tool is not explicitly disallowed, it is allowed**
- Debugging checklist when tools are rejected

## Build & package

```bash
# Development
bun run dev

# Compile renderer + main + preload
bun run build

# App icons (from repo-root logo.png → apps/desktop/packaging/; icons are committed for CI)
bun run icons

# Local installer for the current OS/arch only (run from repo root)
bun run pack
```

| Host | Output |
|------|--------|
| macOS Apple Silicon | `apps/desktop/release/Eco-Coding-*-mac-arm64.dmg` |
| Windows x64 | `apps/desktop/release/Eco-Coding-*-win-x64.exe` |
| Linux x64 | `apps/desktop/release/Eco-Coding-*-linux-x64.AppImage` |

Explicit platform scripts remain available for CI: `pack:mac-arm64`, `pack:win-x64`, `pack:linux-x64`.

### Release (GitHub Actions)

Pushing a semver tag triggers a matrix build on macOS, Windows, and Linux; artifacts are published to [GitHub Releases](https://github.com/plus1998/eco-coding/releases).

```bash
git tag v0.1.0
git push origin v0.1.0
```

The workflow reads the tag (e.g. `v0.1.0` → version `0.1.0`) and sets `apps/desktop/package.json` before packing.

macOS packages are unsigned by default (`identity: null` in `apps/desktop/electron-builder.yml`). For distribution, set a valid `CSC_NAME` / Developer ID and adjust signing in that file.

Linux AppImages are portable `*.AppImage` files. Some distros need [FUSE](https://github.com/AppImage/AppImageKit/wiki/FUSE) to run AppImages.

## Repository shape

```txt
apps/
  desktop/        Electron and React desktop shell
packages/
  shared/         Shared schemas and event contracts
  runtime/        Thread worker lifecycle and agent runtime boundary
  agent/          Thread orchestration service
  model-router/   Anthropic-compatible endpoint routing and checks
  workspace/      Git worktree and diff workflow
  approval/       Dangerous operation approval service
  terminal/       PTY session manager boundary
```
