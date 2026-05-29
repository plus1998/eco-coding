import { expect, test } from "bun:test";
import {
  composeCanUseToolHandlers,
  createAskUserQuestionHandler,
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
