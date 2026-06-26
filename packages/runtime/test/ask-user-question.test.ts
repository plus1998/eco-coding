import { expect, test } from "bun:test";
import {
  composeCanUseToolHandlers,
  createAskUserQuestionHandler,
  formatAskUserQuestionToolResult,
  parseAskUserQuestionInput,
} from "../src/ask-user-question";
import type { SdkToolPermissionRequest } from "../src/claude-agent-sdk";

test("parses AskUserQuestion input", () => {
  const parsed = parseAskUserQuestionInput({
    questions: [
      {
        question: "Which API?",
        header: "Scope",
        options: [
          { label: "REST", description: "Use REST", recommended: true },
          { label: "GraphQL" },
        ],
      },
    ],
  });
  expect(parsed.questions).toHaveLength(1);
  expect(parsed.questions[0]?.question).toBe("Which API?");
  expect(parsed.questions[0]?.options).toHaveLength(2);
  expect(parsed.questions[0]?.options[0]?.recommended).toBe(true);
});

test("createAskUserQuestionHandler returns updated input", async () => {
  const handler = createAskUserQuestionHandler(async () => ({
    questions: [{ question: "Q", answer: "REST" }],
  }));

  const decision = await handler({
    toolName: "AskUserQuestion",
    input: { questions: [{ question: "Q", options: [{ label: "REST" }] }] },
    toolUseId: "tool_1",
    signal: new AbortController().signal,
  });

  expect(decision.behavior).toBe("allow");
  expect(decision.updatedInput).toEqual({
    questions: [{ question: "Q", answer: "REST" }],
  });
});

test("formatAskUserQuestionToolResult matches Claude Code tool_result wording", () => {
  expect(
    formatAskUserQuestionToolResult({
      "Which API?": "REST",
      "Pick stacks": ["Vue", "Pinia"],
    }),
  ).toBe(
    'User has answered your questions: "Which API?"="REST", "Pick stacks"="Vue, Pinia". You can now continue with the user\'s answers in mind.',
  );
});

test("composeCanUseToolHandlers short-circuits on AskUserQuestion", async () => {
  const ask = createAskUserQuestionHandler(async () => ({ answered: true }));
  const composed = composeCanUseToolHandlers(ask, async () => ({
    behavior: "deny",
    message: "should not run",
  }));

  const request: SdkToolPermissionRequest = {
    toolName: "AskUserQuestion",
    input: { question: "Hi?" },
    toolUseId: "t1",
    signal: new AbortController().signal,
  };

  const decision = await composed(request);
  expect(decision.behavior).toBe("allow");
  expect(decision.updatedInput).toEqual({ answered: true });
});

test("composeCanUseToolHandlers chains updated input across handlers", async () => {
  const composed = composeCanUseToolHandlers(
    async (request) => ({
      behavior: "allow",
      updatedInput: { ...request.input, step: 1 },
    }),
    async (request) => ({
      behavior: "allow",
      updatedInput: { ...request.input, step: 2 },
    }),
  );

  const decision = await composed({
    toolName: "Agent",
    input: { subagent_type: "reviewer" },
    toolUseId: "t2",
    signal: new AbortController().signal,
  });

  expect(decision.updatedInput).toEqual({ subagent_type: "reviewer", step: 2 });
});
