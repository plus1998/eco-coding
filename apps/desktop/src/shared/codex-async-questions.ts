import type { CodexAsyncQuestionsInput, CodexAsyncUserInputQuestion } from "@eco/runtime";
import type { ClarificationAnswers, ClarificationQuestion, ClarificationRequest } from "./ipc";

/**
 * Codex 0.160 async questions (`request_user_input_async`) against Eco's clarification UI.
 *
 * The questions ride on an `agentMessage` item whose id is the tool call id, so the
 * item id is the stable identity upstream uses to match answers back to questions.
 */

/** Tool name upstream hardcodes into every async `questionItemId`. */
export const CODEX_ASYNC_QUESTION_TOOL = "request_user_input_async";

/**
 * `["request_user_input_async", <agentMessage item id>, <question index>]`.
 * Mirrors `codex-rs/tui/src/bottom_pane/async_questions/state.rs` byte for byte —
 * upstream compares this string against the reply's `questionItemId`.
 */
export function buildCodexAsyncQuestionItemId(messageId: string, questionIndex: number): string {
  return JSON.stringify([CODEX_ASYNC_QUESTION_TOOL, messageId, questionIndex]);
}

export interface CodexAsyncQuestionRef {
  /** `questionItemId` echoed back in the reply envelope. */
  questionItemId: string;
  /** Question title, shown to the user and echoed back for context. */
  title: string;
  /** Option labels, in display order. Empty = free text only. */
  options: string[];
}

export interface CodexAsyncQuestionRefs {
  messageId: string;
  refs: CodexAsyncQuestionRef[];
}

/** Resolve the questions of one async message into reply-addressable refs. */
export function resolveCodexAsyncQuestionRefs(input: {
  itemId: string;
  questions: readonly CodexAsyncUserInputQuestion[];
}): CodexAsyncQuestionRefs {
  return {
    messageId: input.itemId,
    refs: input.questions.map((question, index) => ({
      questionItemId: buildCodexAsyncQuestionItemId(input.itemId, index),
      title: question.title,
      options: (question.options ?? []).filter((option) => option.trim().length > 0),
    })),
  };
}

/**
 * Map async questions onto Eco's clarification questions.
 *
 * Titles are self-contained (upstream asks the model for "the complete question …
 * including any context needed to answer it"), so they become the question text with
 * no synthesized header. Suggested options are suggestions only: upstream allows a
 * free-text answer for every async question, so `allowCustom` stays true even when
 * the model proposed options.
 */
export function mapCodexAsyncQuestionsToClarification(input: {
  refs: readonly CodexAsyncQuestionRef[];
}): ClarificationQuestion[] {
  return input.refs.map((ref) => ({
    question: ref.title,
    options: ref.options.map((label) => ({ label })),
    allowCustom: true,
  }));
}

/**
 * Build the clarification request shown for an async question message.
 *
 * `delivery: "async"` marks it non-blocking: the Codex turn keeps running, so this
 * panel must never gate the run or the follow-up queue.
 */
export function buildCodexAsyncClarificationRequest(input: {
  ecoThreadId: string;
  messageId: string;
  questions: readonly CodexAsyncUserInputQuestion[];
}): { request: ClarificationRequest; refs: CodexAsyncQuestionRefs } {
  const refs = resolveCodexAsyncQuestionRefs({ itemId: input.messageId, questions: input.questions });
  return {
    refs,
    request: {
      toolUseId: input.messageId,
      threadId: input.ecoThreadId,
      questions: mapCodexAsyncQuestionsToClarification({ refs: refs.refs }),
      delivery: "async",
    },
  };
}

export interface CodexAsyncQuestionReply {
  questionItemId: string;
  question: string;
  answer: string;
}

const REPLY_OPEN = "<send_user_message_question_reply>";
const REPLY_CLOSE = "</send_user_message_question_reply>";

/**
 * Build the reply text upstream recognizes.
 *
 * `codex-rs/tui/src/async_question_reply.rs` parses exactly
 * `<send_user_message_question_reply>` + JSON array + `</send_user_message_question_reply>`
 * and dismisses the matching question, so this envelope is the delivery format for
 * both the model and any other Codex client watching the same thread.
 */
export function buildCodexAsyncQuestionReplyText(replies: readonly CodexAsyncQuestionReply[]): string {
  return `${REPLY_OPEN}${JSON.stringify(replies)}${REPLY_CLOSE}`;
}

/**
 * Pair clarification selections with their async question refs.
 *
 * `answers.selections[i]` is the answer row for `refs[i]` (Eco preserves question
 * order). Empty rows are skipped: upstream treats an absent answer as unanswered
 * rather than as an empty reply.
 */
export function buildCodexAsyncQuestionReplies(input: {
  refs: readonly CodexAsyncQuestionRef[];
  answers: ClarificationAnswers;
}): CodexAsyncQuestionReply[] {
  const replies: CodexAsyncQuestionReply[] = [];
  for (const [index, ref] of input.refs.entries()) {
    const answer = (input.answers.selections[index] ?? []).join("\n").trim();
    if (!answer) {
      continue;
    }
    replies.push({ questionItemId: ref.questionItemId, question: ref.title, answer });
  }
  return replies;
}

/**
 * Stable dedupe key for one async question message: thread + turn + message id.
 * `item/started` and `item/completed` carry the same item, and a resumed thread can
 * replay it, so the same message must never register the panel twice.
 */
export function codexAsyncQuestionDedupeKey(input: {
  ecoThreadId: string;
  turnId?: string | undefined;
  itemId: string;
}): string {
  return [input.ecoThreadId.trim(), (input.turnId ?? "").trim(), input.itemId.trim()].join("\u0000");
}

/** True when the notification is an async question message (never a server request). */
export function hasCodexAsyncQuestions(input: CodexAsyncQuestionsInput): boolean {
  return input.questions.length > 0;
}
