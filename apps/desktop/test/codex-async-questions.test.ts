import { expect, test } from "bun:test";
import {
  buildCodexAsyncClarificationRequest,
  buildCodexAsyncQuestionItemId,
  buildCodexAsyncQuestionReplies,
  buildCodexAsyncQuestionReplyText,
  codexAsyncQuestionDedupeKey,
  formatCodexAsyncQuestionReplySummary,
  hasCodexAsyncQuestions,
  mapCodexAsyncQuestionsToClarification,
  parseCodexAsyncQuestionReplyText,
  resolveCodexAsyncQuestionRefs,
} from "../src/shared/codex-async-questions";

test("reply display decodes complete envelopes without losing multiline answers or punctuation", () => {
  const replies = [
    {
      questionItemId: buildCodexAsyncQuestionItemId("item-1", 0),
      question: "库？；版本 →",
      answer: 'bun\n保留 <xml> & 引号"',
    },
    { questionItemId: buildCodexAsyncQuestionItemId("item-1", 1), question: "时间？", answer: "下周" },
  ];
  const text = buildCodexAsyncQuestionReplyText(replies);
  expect(parseCodexAsyncQuestionReplyText(`\n${text}\n`)).toEqual(replies);
  expect(formatCodexAsyncQuestionReplySummary(replies)).toBe(
    '库？；版本 → → bun\n保留 <xml> & 引号"\n时间？ → 下周',
  );
  expect(formatCodexAsyncQuestionReplySummary(replies)).not.toContain("questionItemId");
});

test("reply display does not reinterpret partial, embedded or malformed protocol examples", () => {
  const valid = buildCodexAsyncQuestionReplyText([
    { questionItemId: "q1", question: "问题", answer: "回答" },
  ]);
  for (const text of [
    "普通消息",
    `请看示例：${valid}`,
    `${valid}\n请解释`,
    valid.slice(0, -1),
    "<send_user_message_question_reply>bad JSON</send_user_message_question_reply>",
    buildCodexAsyncQuestionReplyText([]),
    '<send_user_message_question_reply>[{"questionItemId":"q1","question":"问题","answer":42}]</send_user_message_question_reply>',
    '<send_user_message_question_reply>[{"questionItemId":"q1","question":"问题","answer":"回答"},null]</send_user_message_question_reply>',
  ])
    expect(parseCodexAsyncQuestionReplyText(text)).toBeUndefined();
});

test("questionItemId matches the upstream [tool, itemId, index] encoding", () => {
  expect(buildCodexAsyncQuestionItemId("item-1", 0)).toBe('["request_user_input_async","item-1",0]');
  expect(buildCodexAsyncQuestionItemId("item-1", 2)).toBe('["request_user_input_async","item-1",2]');
});

test("options are suggestions: free text stays allowed and empty option lists drop out", () => {
  const refs = resolveCodexAsyncQuestionRefs({
    itemId: "item-1",
    questions: [
      { title: "自由文本问题", options: null },
      { title: "有选项的问题", options: ["A", "  ", "B"] },
    ],
  });

  expect(refs.refs).toEqual([
    { questionItemId: '["request_user_input_async","item-1",0]', title: "自由文本问题", options: [] },
    { questionItemId: '["request_user_input_async","item-1",1]', title: "有选项的问题", options: ["A", "B"] },
  ]);
  expect(mapCodexAsyncQuestionsToClarification({ refs: refs.refs })).toEqual([
    { question: "自由文本问题", options: [], allowCustom: true },
    { question: "有选项的问题", options: [{ label: "A" }, { label: "B" }], allowCustom: true },
  ]);
});

test("the clarification request is non-blocking and anchored on the message id", () => {
  const { request, refs } = buildCodexAsyncClarificationRequest({
    ecoThreadId: "thread-1",
    messageId: "item-1",
    questions: [{ title: "迁移吗？", options: ["迁移", "稍后"] }],
  });

  expect(request.toolUseId).toBe("item-1");
  expect(request.threadId).toBe("thread-1");
  expect(request.delivery).toBe("async");
  expect(refs.messageId).toBe("item-1");
});

test("answers become the reply envelope upstream parses", () => {
  const refs = resolveCodexAsyncQuestionRefs({
    itemId: "item-1",
    questions: [
      { title: "库？", options: null },
      { title: "时间？", options: ["今天", "下周"] },
    ],
  });
  const replies = buildCodexAsyncQuestionReplies({
    refs: refs.refs,
    answers: { toolUseId: "item-1", selections: [["bun"], ["下周", "以及今天"]] },
  });

  expect(replies).toEqual([
    { questionItemId: '["request_user_input_async","item-1",0]', question: "库？", answer: "bun" },
    {
      questionItemId: '["request_user_input_async","item-1",1]',
      question: "时间？",
      answer: "下周\n以及今天",
    },
  ]);
  expect(buildCodexAsyncQuestionReplyText(replies)).toBe(
    '<send_user_message_question_reply>[{"questionItemId":"[\\"request_user_input_async\\",\\"item-1\\",0]","question":"库？","answer":"bun"},{"questionItemId":"[\\"request_user_input_async\\",\\"item-1\\",1]","question":"时间？","answer":"下周\\n以及今天"}]</send_user_message_question_reply>',
  );
});

test("empty answers are omitted instead of being sent as blank replies", () => {
  const refs = resolveCodexAsyncQuestionRefs({
    itemId: "item-1",
    questions: [
      { title: "a", options: null },
      { title: "b", options: null },
    ],
  });
  expect(
    buildCodexAsyncQuestionReplies({
      refs: refs.refs,
      answers: { toolUseId: "item-1", selections: [["   "], ["答案"]] },
    }),
  ).toEqual([{ questionItemId: '["request_user_input_async","item-1",1]', question: "b", answer: "答案" }]);
});

test("the dedupe key separates thread, turn and message", () => {
  const base = { ecoThreadId: "thread-1", turnId: "turn-1", itemId: "item-1" };
  expect(codexAsyncQuestionDedupeKey(base)).toBe(codexAsyncQuestionDedupeKey({ ...base }));
  expect(codexAsyncQuestionDedupeKey(base)).not.toBe(
    codexAsyncQuestionDedupeKey({ ...base, itemId: "item-2" }),
  );
  expect(codexAsyncQuestionDedupeKey(base)).not.toBe(
    codexAsyncQuestionDedupeKey({ ...base, ecoThreadId: "thread-2" }),
  );
  expect(codexAsyncQuestionDedupeKey(base)).not.toBe(
    codexAsyncQuestionDedupeKey({ ...base, turnId: "turn-2" }),
  );
  // A missing turn id (some notifications omit it) must not collapse into another turn's key.
  expect(codexAsyncQuestionDedupeKey({ ecoThreadId: "thread-1", itemId: "item-1" })).not.toBe(
    codexAsyncQuestionDedupeKey(base),
  );
});

test("hasCodexAsyncQuestions only accepts messages that actually carry questions", () => {
  expect(
    hasCodexAsyncQuestions({
      ecoThreadId: "thread-1",
      codexThreadId: "codex-thread-1",
      itemId: "item-1",
      message: "hi",
      questions: [{ title: "q", options: null }],
    }),
  ).toBe(true);
  expect(
    hasCodexAsyncQuestions({
      ecoThreadId: "thread-1",
      codexThreadId: "codex-thread-1",
      itemId: "item-1",
      message: "hi",
      questions: [],
    }),
  ).toBe(false);
});
