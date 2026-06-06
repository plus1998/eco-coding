import type { SubagentAvailability } from "../subagent-availability.js";
import { defaultSubagentAvailability, ecoSubagentKeyForRole } from "../subagent-availability.js";
import {
  buildQuestionAnswerTaskLine,
  buildQuestionExploreInstruction,
  formatAvailableSubagentsLine,
} from "./subagent-pipeline.js";

export function buildQuestionAnswerSystemAppend(
  availability: SubagentAvailability = defaultSubagentAvailability(),
): string {
  return [
    "Eco orchestration — ANSWER (read-only).",
    "",
    formatAvailableSubagentsLine(availability),
    "",
    "Answer the user's question directly and concisely.",
    buildQuestionExploreInstruction(availability),
    "For a known file or symbol, use Read/Grep directly — do not over-delegate.",
    "Do not create an implementation plan, do not modify files.",
    `Do not call ${ecoSubagentKeyForRole("coder")}, ${ecoSubagentKeyForRole("reviewer")}, ${ecoSubagentKeyForRole("tester")}, or ${ecoSubagentKeyForRole("architect")}.`,
  ].join("\n");
}

/** @deprecated Use buildQuestionAnswerSystemAppend(availability) */
export const questionAnswerSystemAppend = buildQuestionAnswerSystemAppend();

export function buildQuestionAnswerPrompt(
  userPrompt: string,
  availability: SubagentAvailability = defaultSubagentAvailability(),
): string {
  return ["User question:", userPrompt.trim(), "", buildQuestionAnswerTaskLine(availability)].join("\n");
}
