import { expect, test } from "bun:test";
import {
  buildResumeAgentPrompt,
  createSubagentResumePreToolHook,
  isFreshSubagentRequest,
} from "../src/subagent-resume";

test("isFreshSubagentRequest detects opt-out phrases", () => {
  expect(isFreshSubagentRequest("Please restart exploration from scratch")).toBe(true);
  expect(isFreshSubagentRequest("继续审查变更")).toBe(false);
});

test("buildResumeAgentPrompt formats SDK resume line", () => {
  expect(buildResumeAgentPrompt("abc-123", "Review auth module")).toBe(
    "Resume agent abc-123 and Review auth module",
  );
});

test("createSubagentResumePreToolHook rewrites Agent tool input", async () => {
  const hook = createSubagentResumePreToolHook("thr_1", "execution", (input) => {
    if (input.role === "reviewer") {
      return "rev-agent-id";
    }
    return undefined;
  });

  const result = await hook(
    {
      hook_event_name: "PreToolUse",
      tool_name: "Agent",
      tool_input: { subagent_type: "reviewer", prompt: "Review the diff" },
    } as never,
    "tool_1",
  );

  expect(result.hookSpecificOutput?.updatedInput?.prompt).toBe(
    "Resume agent rev-agent-id and Review the diff",
  );
});

test("createSubagentResumePreToolHook skips fresh requests", async () => {
  const hook = createSubagentResumePreToolHook("thr_1", "execution", () => "rev-agent-id");
  const result = await hook(
    {
      hook_event_name: "PreToolUse",
      tool_name: "Agent",
      tool_input: { subagent_type: "reviewer", prompt: "restart review from scratch" },
    } as never,
    "tool_1",
  );
  expect(result.hookSpecificOutput).toBeUndefined();
});
