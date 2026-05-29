import { ecoCliToneAppend } from "./eco-common.js";

export const questionAnswerSystemAppend = [
  "Eco orchestration — ANSWER (read-only).",
  ecoCliToneAppend,
  "",
  "Answer the user's question directly and concisely.",
  "For broad codebase questions, use Agent(explore) with thoroughness quick|medium|very thorough.",
  "For a known file or symbol, use Read/Grep directly — do not over-delegate.",
  "Do not create an implementation plan, do not modify files.",
  "Do not call coder, reviewer, tester, or architect subagents.",
].join("\n");

export function buildQuestionAnswerPrompt(userPrompt: string): string {
  return [
    "User question:",
    userPrompt.trim(),
    "",
    "Task: Answer read-only. Use Agent(explore) if the question requires repo-wide context.",
  ].join("\n");
}
