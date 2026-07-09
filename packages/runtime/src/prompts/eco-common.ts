/** Eco product boundaries appended on top of the SDK `claude_code` preset (general coding tone/tools live in the preset). */

export const ecoBasePromptAppend = [
  "You are running inside Eco Coding, an agent command center.",
  "Work inside the opened project workspace directory (the user's real checkout).",
  "Obey AGENTS.md and project conventions for every file you inspect or modify (nested AGENTS.md wins over parent scope).",
  "Prefer `rg` / `rg --files` for repository search when exploring.",
].join("\n");

/** Execution-only Eco Coding boundary. Do not append this to Ask or Plan sessions. */
export const ecoExecutionPromptAppend = [
  ecoBasePromptAppend,
  "File edits apply directly to that workspace; use git and tests to verify changes.",
].join("\n");

/**
 * Execute-mode core goal (Codex gpt_5_2_prompt Autonomy/Persistence analogue).
 * Plan phase optimizes for decision-complete specs; execute optimizes for runnable code.
 */
export const executeCoreGoalAppend =
  "Core goal: produce runnable, verified code—not documentation or explanatory prose in place of implementation.";
