import type { ClarificationAnswers, ClarificationRequest } from "../shared/ipc";

interface PendingClarification {
  threadId: string;
  request: ClarificationRequest;
  promise: Promise<ClarificationAnswers>;
  resolve: (answers: ClarificationAnswers) => void;
  reject: (error: Error) => void;
}

const pending = new Map<string, PendingClarification>();

export function registerPendingClarification(
  threadId: string,
  toolUseId: string,
  parsed: { questions: ClarificationRequest["questions"] },
): Promise<ClarificationAnswers> {
  if (pending.has(toolUseId)) {
    return Promise.reject(new Error(`Clarification ${toolUseId} is already pending.`));
  }

  let resolveAnswers!: (answers: ClarificationAnswers) => void;
  let rejectAnswers!: (error: Error) => void;
  const promise = new Promise<ClarificationAnswers>((resolve, reject) => {
    resolveAnswers = resolve;
    rejectAnswers = reject;
  });
  pending.set(toolUseId, {
    threadId,
    request: {
      toolUseId,
      threadId,
      questions: parsed.questions,
    },
    promise,
    resolve: resolveAnswers,
    reject: rejectAnswers,
  });
  return promise;
}

export function getPendingClarificationWaitForThread(
  threadId: string,
): Promise<ClarificationAnswers> | undefined {
  for (const entry of pending.values()) {
    if (entry.threadId === threadId) {
      return entry.promise;
    }
  }
  return undefined;
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
  rawInput?: Record<string, unknown>,
): Record<string, unknown> {
  const answersMap: Record<string, string | string[]> = {};

  const rawQuestions = rawInput?.questions;

  for (const [index, question] of request.questions.entries()) {
    const selected = answers.selections[index] ?? [];
    const answerKey = readRawAskUserQuestionKey(rawQuestions, index, question.question);
    if (question.multiSelect) {
      answersMap[answerKey] = selected;
    } else {
      answersMap[answerKey] = selected[0] ?? "";
    }
  }
  const questions =
    Array.isArray(rawQuestions) && rawQuestions.length > 0
      ? rawQuestions
      : request.questions.map((question) => ({
          question: question.question,
          options: question.options.map((option) => ({
            label: option.label,
            ...(option.description ? { description: option.description } : {}),
            ...(option.recommended ? { recommended: true } : {}),
          })),
          ...(question.header ? { header: question.header } : {}),
          ...(question.multiSelect ? { multiSelect: true } : {}),
        }));

  return {
    questions,
    answers: answersMap,
  };
}

export function formatClarificationAnswersSummary(
  request: ClarificationRequest,
  answers: ClarificationAnswers,
): string {
  const parts = request.questions.map((question, index) => {
    const selected = answers.selections[index] ?? [];
    const preview =
      question.question.length > 48 ? `${question.question.slice(0, 45)}…` : question.question;
    if (selected.length === 0) {
      return `${preview} → （未选择）`;
    }
    return `${preview} → ${selected.join("、")}`;
  });
  return `澄清回答：${parts.join("；")}`;
}

function readRawAskUserQuestionKey(
  rawQuestions: unknown,
  index: number,
  fallback: string,
): string {
  if (!Array.isArray(rawQuestions)) {
    return fallback;
  }
  const entry = rawQuestions[index];
  if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
    return fallback;
  }
  const question = (entry as { question?: unknown }).question;
  return typeof question === "string" && question.length > 0 ? question : fallback;
}
