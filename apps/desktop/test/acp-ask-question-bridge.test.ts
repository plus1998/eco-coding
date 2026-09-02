import { expect, test } from "bun:test";
import type { AcpAskQuestionRequest } from "@eco/runtime";
import {
  ACP_ASK_QUESTION_FREEFORM_OPTION_ID,
  createAcpAskQuestionHandler,
  isIgnoredClarificationAnswers,
  mapAcpAskQuestionToClarification,
  mapClarificationAnswersToAcpAskQuestion,
  parseAcpAskQuestionQuestions,
} from "../src/main/acp-ask-question-bridge";
import { buildIgnoredClarificationAnswers } from "../src/main/clarification-bridge";
import type { ClarificationAnswers } from "../src/shared/ipc";

const SAMPLE_REQUEST: AcpAskQuestionRequest = {
  toolCallId: "call_123",
  title: "Need input",
  questions: [
    {
      id: "q1",
      prompt: "Which mode should I use?",
      options: [
        { id: "agent", label: "Agent" },
        { id: "plan", label: "Plan" },
        { id: ACP_ASK_QUESTION_FREEFORM_OPTION_ID, label: "Other" },
      ],
      allowMultiple: false,
    },
    {
      id: "q2",
      prompt: "Pick frameworks",
      options: [
        { id: "react", label: "React" },
        { id: "vue", label: "Vue" },
      ],
      allowMultiple: true,
    },
  ],
};

test("parseAcpAskQuestionQuestions reads id/prompt/options and skips empty rows", () => {
  expect(
    parseAcpAskQuestionQuestions([
      SAMPLE_REQUEST.questions[0],
      { id: "bad", prompt: "No options", options: [] },
      null,
      { prompt: "Fallback id", options: [{ label: "Only" }] },
    ]),
  ).toMatchObject([
    { id: "q1", prompt: "Which mode should I use?", allowMultiple: false },
    { id: "q3", prompt: "Fallback id", options: [{ id: "opt0", label: "Only" }] },
  ]);
});

test("mapAcpAskQuestionToClarification builds Eco clarification request", () => {
  const mapped = mapAcpAskQuestionToClarification("thr_1", SAMPLE_REQUEST);
  expect(mapped?.request).toMatchObject({
    toolUseId: "call_123",
    threadId: "thr_1",
  });
  expect(mapped?.request.questions).toEqual([
    {
      question: "Which mode should I use?",
      header: "Need input",
      options: [{ label: "Agent" }, { label: "Plan" }, { label: "Other" }],
      allowCustom: true,
    },
    {
      question: "Pick frameworks",
      header: "Need input",
      options: [{ label: "React" }, { label: "Vue" }],
      multiSelect: true,
      allowCustom: true,
    },
  ]);
  expect(mapped?.questions.map((q) => q.id)).toEqual(["q1", "q2"]);
});

test("mapClarificationAnswersToAcpAskQuestion maps labels to option ids", () => {
  const mapped = mapAcpAskQuestionToClarification("thr_1", SAMPLE_REQUEST)!;
  const answers: ClarificationAnswers = {
    toolUseId: "call_123",
    selections: [["Plan"], ["React", "Vue"]],
  };
  expect(mapClarificationAnswersToAcpAskQuestion(mapped, answers)).toEqual([
    { questionId: "q1", selectedOptionIds: ["plan"] },
    { questionId: "q2", selectedOptionIds: ["react", "vue"] },
  ]);
});

test("mapClarificationAnswersToAcpAskQuestion keeps freeform text on the wire", () => {
  const mapped = mapAcpAskQuestionToClarification("thr_1", SAMPLE_REQUEST)!;
  expect(
    mapClarificationAnswersToAcpAskQuestion(mapped, {
      toolUseId: "call_123",
      selections: [["ship with custom mode"], ["React"]],
    }),
  ).toEqual([
    { questionId: "q1", selectedOptionIds: ["ship with custom mode"] },
    { questionId: "q2", selectedOptionIds: ["react"] },
  ]);
  expect(
    mapClarificationAnswersToAcpAskQuestion(mapped, {
      toolUseId: "call_123",
      selections: [["Other"], []],
    }),
  ).toEqual([
    { questionId: "q1", selectedOptionIds: [ACP_ASK_QUESTION_FREEFORM_OPTION_ID] },
    { questionId: "q2", selectedOptionIds: [] },
  ]);
});

test("createAcpAskQuestionHandler parks clarification and answers with option ids", async () => {
  const events: Array<{ type: string; message: string }> = [];
  let pendingResolve: ((answers: ClarificationAnswers) => void) | undefined;
  const handler = createAcpAskQuestionHandler("thr_1", {
    updateThreadRunning: () => {},
    emit: (type, message) => {
      events.push({ type, message });
    },
    registerPending: async (_threadId, toolUseId, questions) => {
      expect(toolUseId).toBe("call_123");
      expect(questions).toHaveLength(2);
      return await new Promise<ClarificationAnswers>((resolve) => {
        pendingResolve = resolve;
      });
    },
  });

  const pending = handler(SAMPLE_REQUEST);
  expect(events[0]?.type).toBe("clarification.requested");
  pendingResolve?.({
    toolUseId: "call_123",
    selections: [["Agent"], ["Vue"]],
  });
  await expect(pending).resolves.toEqual({
    outcome: "answered",
    answers: [
      { questionId: "q1", selectedOptionIds: ["agent"] },
      { questionId: "q2", selectedOptionIds: ["vue"] },
    ],
  });
  expect(events.at(-1)?.type).toBe("clarification.answered");
});

test("createAcpAskQuestionHandler skips when user dismisses clarification", async () => {
  const mapped = mapAcpAskQuestionToClarification("thr_1", SAMPLE_REQUEST)!;
  const ignored = buildIgnoredClarificationAnswers(mapped.request);
  expect(isIgnoredClarificationAnswers(mapped.request, ignored)).toBe(true);

  const handler = createAcpAskQuestionHandler("thr_1", {
    updateThreadRunning: () => {},
    emit: () => {},
    registerPending: async () => ignored,
  });
  await expect(handler(SAMPLE_REQUEST)).resolves.toEqual({
    outcome: "skipped",
    reason: "user dismissed clarification",
  });
});

test("createAcpAskQuestionHandler returns cancelled when pending rejects with cancel", async () => {
  const handler = createAcpAskQuestionHandler("thr_1", {
    updateThreadRunning: () => {},
    emit: () => {},
    registerPending: async () => {
      throw new Error("cancelled by user");
    },
  });
  await expect(handler(SAMPLE_REQUEST)).resolves.toEqual({ outcome: "cancelled" });
});

test("createAcpAskQuestionHandler skips when questions are empty", async () => {
  const handler = createAcpAskQuestionHandler("thr_1", {
    updateThreadRunning: () => {},
    emit: () => {},
  });
  await expect(handler({ toolCallId: "call_empty", questions: [] })).resolves.toEqual({
    outcome: "skipped",
    reason: "ACP cursor/ask_question had no usable questions",
  });
});

test("mapAcpAskQuestionToClarification rejects blank toolCallId", () => {
  expect(
    mapAcpAskQuestionToClarification("thr_1", {
      toolCallId: "   ",
      questions: SAMPLE_REQUEST.questions,
    }),
  ).toBeUndefined();
});
