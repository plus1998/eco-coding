/**
 * Codex CLI open-source compact prompts (verbatim).
 * Sources:
 * - codex-rs/prompts/templates/compact/prompt.md
 * - codex-rs/prompts/templates/compact/summary_prefix.md
 */

/** Codex compact/prompt.md — only as the summary-model system prompt. */
export const CODEX_COMPACT_SYSTEM_PROMPT = [
  "You are performing a CONTEXT CHECKPOINT COMPACTION. Create a handoff summary for another LLM that will resume the task.",
  "",
  "Include:",
  "- Current progress and key decisions made",
  "- Important context, constraints, or user preferences",
  "- What remains to be done (clear next steps)",
  "- Any critical data, examples, or references needed to continue",
  "",
  "Be concise, structured, and focused on helping the next LLM seamlessly continue the work.",
].join("\n");

/** Codex compact/summary_prefix.md — prepended when the next agent receives the handoff. */
export const CODEX_COMPACT_SUMMARY_PREFIX =
  "Another language model started to solve this problem and produced a summary of its thinking process. You also have access to the state of the tools that were used by that language model. Use this to build on the work that has already been done and avoid duplicating work. Here is the summary produced by the other language model, use the information in this summary to assist with your own analysis:";
