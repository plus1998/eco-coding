import { expect, test } from "bun:test";
import {
  buildResumeAgentPrompt,
  createSubagentResumePreToolHook,
  isFreshSubagentRequest,
  normalizeAgentToolInputSubagentType,
  normalizeSdkSubagentType,
} from "../src/subagent-resume";
import { ecoSubagentKeyForRole } from "../src/subagent-availability";

test("normalizeSdkSubagentType maps Explore to explore", () => {
  expect(normalizeSdkSubagentType("Explore")).toBe("explore");
  expect(normalizeSdkSubagentType(ecoSubagentKeyForRole("explore"))).toBe("explore");
  expect(normalizeSdkSubagentType("explore")).toBe("explore");
  expect(normalizeSdkSubagentType(ecoSubagentKeyForRole("coder"))).toBe("coder");
  expect(normalizeSdkSubagentType("coder")).toBe("coder");
  expect(normalizeSdkSubagentType("Plan")).toBeUndefined();
});

test("normalizeAgentToolInputSubagentType rewrites legacy names to eco keys", () => {
  expect(
    normalizeAgentToolInputSubagentType({ subagent_type: "Explore", prompt: "Map auth" }),
  ).toMatchObject({
    role: "explore",
    changed: true,
    input: { subagent_type: ecoSubagentKeyForRole("explore"), prompt: "Map auth" },
  });
  expect(
    normalizeAgentToolInputSubagentType({ agent_type: "reviewer", prompt: "Review" }),
  ).toMatchObject({
    role: "reviewer",
    changed: true,
    input: { subagent_type: ecoSubagentKeyForRole("reviewer"), prompt: "Review" },
  });
});

test("isFreshSubagentRequest detects opt-out phrases", () => {
  expect(isFreshSubagentRequest("Please restart exploration from scratch")).toBe(true);
  expect(isFreshSubagentRequest("继续审查变更")).toBe(false);
});

test("buildResumeAgentPrompt formats SDK resume line", () => {
  expect(buildResumeAgentPrompt("abc-123", "Review auth module")).toBe(
    "Resume agent abc-123 and Review auth module",
  );
});

test("createSubagentResumePreToolHook rewrites Explore to explore role", async () => {
  const hook = createSubagentResumePreToolHook("thr_1", "planning", (input) => {
    expect(input.role).toBe("explore");
    return "explore-agent-id";
  });

  const result = await hook(
    {
      hook_event_name: "PreToolUse",
      tool_name: "Agent",
      tool_input: { subagent_type: "Explore", prompt: "Map auth flow" },
    } as never,
    "tool_explore",
  );

  expect(result.hookSpecificOutput?.updatedInput?.prompt).toBe(
    "Resume agent explore-agent-id and Map auth flow",
  );
  expect(result.hookSpecificOutput?.updatedInput?.subagent_type).toBe(
    ecoSubagentKeyForRole("explore"),
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
  expect(result.hookSpecificOutput?.updatedInput?.subagent_type).toBe(
    ecoSubagentKeyForRole("reviewer"),
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
