import type { SdkToolPermissionDecision, SdkToolPermissionRequest } from "./claude-agent-sdk";

export interface SdkAskUserQuestionOption {
  label: string;
  description?: string;
  recommended?: boolean;
}

export interface SdkAskUserQuestionItem {
  question: string;
  header?: string;
  options: SdkAskUserQuestionOption[];
  multiSelect?: boolean;
}

export interface SdkAskUserQuestionRequest {
  questions: SdkAskUserQuestionItem[];
  rawInput: Record<string, unknown>;
}

export type SdkToolPermissionHandler = (
  request: SdkToolPermissionRequest,
) => Promise<SdkToolPermissionDecision>;

const pendingAskUserQuestionAnswers = new Map<string, Record<string, string | string[]>>();

export function stashAskUserQuestionAnswers(
  toolUseId: string,
  answers: Record<string, string | string[]>,
): void {
  pendingAskUserQuestionAnswers.set(toolUseId, answers);
}

export function takeAskUserQuestionAnswers(
  toolUseId: string,
): Record<string, string | string[]> | undefined {
  const answers = pendingAskUserQuestionAnswers.get(toolUseId);
  if (answers) {
    pendingAskUserQuestionAnswers.delete(toolUseId);
  }
  return answers;
}

/** Matches Claude Code AskUserQuestionTool.mapToolResultToToolResultBlockParam content. */
export function formatAskUserQuestionToolResult(
  answers: Record<string, string | string[]>,
): string {
  const answersText = Object.entries(answers)
    .map(([questionText, answer]) => {
      const value = Array.isArray(answer) ? answer.join(", ") : answer;
      return `"${questionText}"="${value}"`;
    })
    .join(", ");
  return `User has answered your questions: ${answersText}. You can now continue with the user's answers in mind.`;
}

export function parseAskUserQuestionInput(input: Record<string, unknown>): SdkAskUserQuestionRequest {
  const questions: SdkAskUserQuestionItem[] = [];
  const raw = input.questions;

  if (Array.isArray(raw)) {
    for (const entry of raw) {
      if (!isRecord(entry)) {
        continue;
      }
      const question = typeof entry.question === "string" ? entry.question.trim() : "";
      if (!question) {
        continue;
      }
      const options: SdkAskUserQuestionOption[] = [];
      if (Array.isArray(entry.options)) {
        for (const opt of entry.options) {
          if (!isRecord(opt)) {
            continue;
          }
          const label = typeof opt.label === "string" ? opt.label.trim() : "";
          if (!label) {
            continue;
          }
          options.push({
            label,
            ...(typeof opt.description === "string" && opt.description.trim()
              ? { description: opt.description.trim() }
              : {}),
            ...(opt.recommended === true ? { recommended: true } : {}),
          });
        }
      }
      questions.push({
        question,
        ...(typeof entry.header === "string" && entry.header.trim() ? { header: entry.header.trim() } : {}),
        options: options.length > 0 ? options : [{ label: "Continue" }],
        ...(entry.multiSelect === true ? { multiSelect: true } : {}),
      });
    }
  }

  if (questions.length === 0 && typeof input.question === "string" && input.question.trim()) {
    questions.push({
      question: input.question.trim(),
      options: [{ label: "OK" }],
    });
  }

  return { questions, rawInput: input };
}

export function createAskUserQuestionHandler(
  delegate: (request: SdkAskUserQuestionRequest & { toolUseId: string }) => Promise<Record<string, unknown>>,
): SdkToolPermissionHandler {
  return async (request) => {
    if (request.toolName !== "AskUserQuestion") {
      return { behavior: "allow", updatedInput: request.input };
    }

    const parsed = parseAskUserQuestionInput(request.input);
    const updatedInput = await delegate({
      ...parsed,
      toolUseId: request.toolUseId,
    });
    return { behavior: "allow", updatedInput };
  };
}

export function composeCanUseToolHandlers(
  ...handlers: SdkToolPermissionHandler[]
): SdkToolPermissionHandler {
  return async (request) => {
    let currentInput = request.input;

    for (const handler of handlers) {
      const decision = await handler({ ...request, input: currentInput });
      if (decision.behavior === "deny") {
        return decision;
      }
      if (decision.updatedInput !== undefined) {
        currentInput = decision.updatedInput;
      }
      if (request.toolName === "AskUserQuestion") {
        return { behavior: "allow", updatedInput: currentInput };
      }
    }

    return { behavior: "allow", updatedInput: currentInput };
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
