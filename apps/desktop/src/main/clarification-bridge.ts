import type { SdkAskUserQuestionRequest } from "@eco/runtime";
import type { ClarificationRequest, ClarificationAnswers } from "../shared/ipc";

interface PendingClarification {
  threadId: string;
  request: ClarificationRequest;
  resolve: (answers: ClarificationAnswers) => void;
  reject: (error: Error) => void;
}

const pending = new Map<string, PendingClarification>();

export function registerPendingClarification(
  threadId: string,
  toolUseId: string,
  parsed: SdkAskUserQuestionRequest,
): Promise<ClarificationAnswers> {
  if (pending.has(toolUseId)) {
    return Promise.reject(new Error(`Clarification ${toolUseId} is already pending.`));
  }

  return new Promise<ClarificationAnswers>((resolve, reject) => {
    pending.set(toolUseId, {
      threadId,
      request: {
        toolUseId,
        threadId,
        questions: parsed.questions,
      },
      resolve,
      reject,
    });
  });
}

export function getPendingClarificationForThread(threadId: string): ClarificationRequest | undefined {
  for (const entry of pending.values()) {
    if (entry.threadId === threadId) {
      return entry.request;
    }
  }
  return undefined;
}

export function getPendingClarificationByToolUseId(toolUseId: string): ClarificationRequest | undefined {
  return pending.get(toolUseId)?.request;
}

export function submitClarification(toolUseId: string, answers: ClarificationAnswers): boolean {
  const entry = pending.get(toolUseId);
  if (!entry) {
    return false;
  }
  pending.delete(toolUseId);
  entry.resolve(answers);
  return true;
}

export function cancelClarificationsForThread(threadId: string, reason: string): void {
  for (const [toolUseId, entry] of pending) {
    if (entry.threadId !== threadId) {
      continue;
    }
    pending.delete(toolUseId);
    entry.reject(new Error(reason));
  }
}

export function buildIgnoredClarificationAnswers(request: ClarificationRequest): ClarificationAnswers {
  const skipped = "忽略 — 请根据代码与常见做法推进，并在计划中写明假设";
  return {
    toolUseId: request.toolUseId,
    selections: request.questions.map(() => [skipped]),
  };
}

export function buildAskUserQuestionUpdatedInput(
  request: ClarificationRequest,
  answers: ClarificationAnswers,
): Record<string, unknown> {
  return {
    questions: request.questions.map((question, index) => {
      const selected = answers.selections[index] ?? [];
      return {
        question: question.question,
        ...(question.header ? { header: question.header } : {}),
        options: question.options,
        ...(question.multiSelect ? { multiSelect: true } : {}),
        answer: question.multiSelect ? selected : (selected[0] ?? ""),
      };
    }),
  };
}
