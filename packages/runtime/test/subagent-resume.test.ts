import { expect, test } from "bun:test";
import {
  buildResumeAgentPrompt,
  createSubagentResumePreToolHook,
  isFreshSubagentRequest,
  normalizeAgentToolInputSubagentType,
  normalizeSdkSubagentType,
  readAgentSubagentType,
} from "../src/subagent-resume";
import { ecoSubagentKeyForRole } from "../src/subagent-availability";

test("normalizeSdkSubagentType rejects SDK built-in Explore and maps Eco keys", () => {
  expect(normalizeSdkSubagentType("Explore")).toBeUndefined();
  expect(normalizeSdkSubagentType(ecoSubagentKeyForRole("explore"))).toBe("explore");
  expect(normalizeSdkSubagentType("explore")).toBe("explore");
  expect(normalizeSdkSubagentType(ecoSubagentKeyForRole("coder"))).toBe("coder");
  expect(normalizeSdkSubagentType("coder")).toBe("coder");
  expect(normalizeSdkSubagentType("eco_researcher")).toBe("researcher");
  expect(normalizeSdkSubagentType("researcher")).toBeUndefined();
  expect(normalizeSdkSubagentType("Plan")).toBeUndefined();
});

test("normalizeAgentToolInputSubagentType rewrites Eco runtime names to eco keys", () => {
  expect(
    normalizeAgentToolInputSubagentType({ subagent_type: "Explore", prompt: "Map auth" }),
  ).toMatchObject({
    changed: false,
    input: { subagent_type: "Explore", prompt: "Map auth" },
  });
  expect(
    normalizeAgentToolInputSubagentType({ agent_type: "reviewer", prompt: "Review" }),
  ).toMatchObject({
    role: "reviewer",
    changed: true,
    input: { subagent_type: ecoSubagentKeyForRole("reviewer"), prompt: "Review" },
  });
  expect(
    normalizeAgentToolInputSubagentType({ agent_type: "eco_researcher", prompt: "Research" }),
  ).toMatchObject({
    role: "researcher",
    changed: true,
    input: { subagent_type: "eco_researcher", prompt: "Research" },
  });
});

test("readAgentSubagentType reads PI Agent tool `agent` field", () => {
  expect(readAgentSubagentType({ agent: "smoke_worker", task: "do work" })).toBe("smoke_worker");
  expect(readAgentSubagentType({ subagent_type: "coder", agent: "smoke_worker" })).toBe("coder");
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

test("createSubagentResumePreToolHook ignores SDK built-in Explore", async () => {
  let called = false;
  const hook = createSubagentResumePreToolHook("thr_1", "planning", (input) => {
    called = true;
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

  expect(result.hookSpecificOutput).toBeUndefined();
  expect(called).toBe(false);
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

test("createSubagentResumePreToolHook resolves dynamic Eco agent keys", async () => {
  const hook = createSubagentResumePreToolHook("thr_1", "execution", (input) => {
    expect(input.role).toBe("researcher");
    return "research-agent-id";
  });

  const result = await hook(
    {
      hook_event_name: "PreToolUse",
      tool_name: "Agent",
      tool_input: { agent_type: "eco_researcher", prompt: "Research pricing" },
    } as never,
    "tool_researcher",
  );

  expect(result.hookSpecificOutput?.updatedInput).toMatchObject({
    prompt: "Resume agent research-agent-id and Research pricing",
    subagent_type: "eco_researcher",
  });
  expect(result.hookSpecificOutput?.updatedInput).not.toHaveProperty("agent_type");
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
