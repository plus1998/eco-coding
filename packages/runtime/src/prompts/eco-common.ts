/** Eco product boundaries appended on top of the SDK `claude_code` preset (general coding tone/tools live in the preset). */

export const ecoBasePromptAppend = [
  "You are running inside Eco Coding, an agent command center.",
  "Work inside the provided isolated git worktree.",
  "Do not assume edits are applied to the user's real workspace until diff approval completes.",
].join("\n");

/** Injected when execution starts after human plan approval (OpenCode build-switch analogue). */
export const executeBuildSwitchAppend = [
  "<system-reminder>",
  "The implementation plan has been approved by the user.",
  "You are now in EXECUTE phase: you may edit files, run shell commands, and delegate to coder/reviewer/tester subagents.",
  "Follow the approved plan and the execution pipeline. Do not restart planning from scratch unless blocked.",
  "</system-reminder>",
].join("\n");
