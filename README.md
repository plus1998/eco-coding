# Eco Coding

Anthropic-compatible AI coding agent desktop app.

The first version focuses on a router-first command center:

- Claude Agent SDK runtime with native subagents. The **main agent** (Planner session) orchestrates work in a single SDK session: it may edit directly, delegate to Eco subagents when their **description** fits, or call **`ExitPlanMode`** when a formal plan needs approval. There is **no fixed** explore → architect → coder → reviewer → tester pipeline. Subagents cannot nest; only the main session spawns subagents.
- Anthropic-compatible model endpoints only.
- Worker-per-thread isolation.
- SQLite event storage with secrets kept in the system keychain.
- Direct workspace editing with SDK file checkpointing for rewind; session diffs tracked via git in the opened project.

## Thread modes

| Mode | When | Runtime entry | SDK `permissionMode` |
|------|------|---------------|----------------------|
| **Coding (default)** | New coding thread or autonomous continue | `driver.run()` | `acceptEdits` |
| **Plan continuation** | Plan Mode enabled + revise/fresh plan, or resume planning | `runContinuation("planning")` | `plan` (official Claude Plan Mode) |
| **Plan execution** | User approves a pending plan | `runContinuation("execution", planning)` | `acceptEdits` (same session) |
| **Question** | User intent is Q&A | `runQuestion()` | `dontAsk` (read-only) |

**Plan Mode** (`planModeEnabled` in thread/composer settings) changes **continuation routing** and enables SDK Plan Mode on planning turns. It does **not** start a separate “manual orchestration” driver. The main agent still chooses when to explore, delegate, implement, or submit a plan via `ExitPlanMode`.

Plan approval uses the **ExitPlanMode bridge**: hooks capture the plan, Eco shows the approval UI, and execution continues in the **same SDK session** after approval (not a second isolated execution run).

## System prompt and project context

Eco uses the Claude Agent SDK **`claude_code` preset** for the main Planner session. That preset is the same built-in coding system prompt Claude Code uses (tool usage, coding philosophy, safety, tone). Eco only **appends** product-specific rules on top: orchestration boundaries, profile roster, and deliverable headings the UI parses (e.g. reviewer `## P0` / `## Review Verdict`, tester `## Test Verdict`).

Project conventions belong in **`CLAUDE.md`** (or `.claude/CLAUDE.md`) in the opened workspace, not in Eco's code. The runtime loads them automatically via `settingSources: ["user", "project"]`:

- **Project** — `CLAUDE.md` / `.claude/CLAUDE.md` in the workspace cwd
- **User** — `~/.claude/CLAUDE.md` for personal defaults

Optional: set `excludeDynamicSections: true` on `ClaudeAgentSdkDriver` if you need better prompt-cache reuse across threads (trades slightly weaker in-system cwd emphasis for cache hits).

## Prompt architecture

Prompts are layered. The SDK merges them into `systemPrompt` (preset + append) and per-subagent `agents` definitions.

### Main agent system prompt (every session)

Built in `runSingleSession()` (`packages/runtime/src/claude-agent-sdk.ts`):

```txt
claude_code preset (SDK built-in)
  + ecoBasePromptAppend                    # coding preset profiles
    OR universalEcoBasePromptAppend        # non-coding / universal profiles
  + phaseAppend                            # mode-specific orchestration (see below)
  + buildMainAgentProfileAppend()          # when an orchestration profile is active:
      profile name/preset, strategy guidance, subagent roster
  + buildMainAgentHandsOnBoundaryAppend()  # mirrors PreToolUse policy (writes/Bash)
```

| `phaseAppend` source | Used in |
|----------------------|---------|
| `buildAutonomousOrchestratorAppend()` | Default coding: `run()`, plan/execution continuation |
| `buildUniversalPhaseAppend(phase)` | Universal (non-coding) profiles |
| `buildQuestionAnswerSystemAppend()` | `runQuestion()` |

**Coding orchestration append** (`packages/runtime/src/prompts/autonomous.ts`) tells the main agent to:

- Delegate only to enabled Eco subagents (`eco_*` keys) or SDK `general-purpose` for complex explore+act work
- **Not** force subagent order or mandatory review/test passes
- Use `AskUserQuestion` for material ambiguity; use `ExitPlanMode` only when a formal plan needs approval
- Avoid the SDK Workflow tool

**Hands-on boundary** (`packages/runtime/src/prompts/subagent-pipeline.ts`) states the same write/Bash rules the Eco tool-policy hook enforces (direct edits vs delegate to coder, Bash allowed or not).

### User-turn prompts (not system)

| Mode | Prompt builder | Notes |
|------|----------------|-------|
| Coding / autonomous | Raw user message | Activity context may be appended on continue (`buildAgentPromptWithContext`) |
| Plan continuation | User message, or `buildUniversalPlanningContinuationPrompt()` | Reminds model to call `ExitPlanMode` with full plan body |
| After plan approval | `buildAutonomousPlanContinuationPrompt()` | System-reminder that plan was approved; same session |
| Question | `buildQuestionAnswerPrompt()` | Read-only task line + explore hint |

### Eco coding subagents (`createAutonomousAgentDefinitions`)

Subagent **description** (routing hint for the main agent) and **prompt** (subagent system instructions) live in `packages/runtime/src/prompts/`:

| Role | Description | Prompt module | Tools (summary) |
|------|-------------|---------------|-----------------|
| **explore** | Read-only discovery | `explore.ts` | Read, Glob, Grep |
| **architect** | Optional parallel task breakdown | `execution-agents.ts` (`executionArchitect*`) | Read + network |
| **coder** | Focused implementation | `execution-agents.ts` (`executionCoder*`) | Read/write + Bash |
| **reviewer** | High-risk review only | `execution-agents.ts` (`reviewerAgentPrompt`) | Read + Bash + network |
| **tester** | Narrow verification | `execution-agents.ts` (`executionTester*`) | Read + Bash + network |

`execution-agents.ts` also defines **planning-only** architect text (`planningArchitect*`) for `createPlanningAgentDefinitions()` (tests/legacy); **live planning continuation uses the autonomous roster** above.

Universal orchestration profiles use **template prompts** from the profile (`agent-orchestration.ts` → `template.prompt`) instead of the built-in coding subagent prompts.

### Runtime injection (hooks, not system append)

- **ExitPlanMode** — captured in hooks; desktop `awaitPlanApproval` shows plan UI; `plan.ready` event for transcript fallback
- **Reviewer scope** — `## Changed files (this session)` injected on `Agent(reviewer)` delegations
- **Subagent handoff** — resume/summary prompt when context is compacted mid-subagent
- **Tool policy** — PreToolUse denies disallowed tools; matches hands-on boundary text

### Deprecated / empty

- `packages/runtime/src/prompts/planning-format.ts` — empty; native Plan Mode owns plan structure
- `createExecutionAgentDefinitions` — alias of `createAutonomousAgentDefinitions`
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

Eco sits on top of the Claude Agent SDK’s two-layer tool model (availability vs permission). Profile tool policy, Bash review mode, Plan mode, and `allowedTools` are easy to confuse.

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
  persistence/    SQLite and keychain ports
  workspace/      Git worktree and diff workflow
  approval/       Dangerous operation approval service
  terminal/       PTY session manager boundary
```
