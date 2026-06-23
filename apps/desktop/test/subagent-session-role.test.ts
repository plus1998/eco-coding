import { expect, test } from "bun:test";
import { SDK_GENERAL_PURPOSE_AGENT_KEY, SDK_PLAN_AGENT_KEY } from "@eco/runtime";
import { resolveSubagentSessionRole } from "../src/shared/subagent-roles";

test("resolveSubagentSessionRole maps eco_* dynamic agent keys", () => {
  expect(resolveSubagentSessionRole("eco_researcher")).toBe("researcher");
  expect(resolveSubagentSessionRole("researcher")).toBe("researcher");
  expect(resolveSubagentSessionRole("eco_coder")).toBe("coder");
});

test("resolveSubagentSessionRole maps SDK built-in agent types", () => {
  expect(resolveSubagentSessionRole(SDK_GENERAL_PURPOSE_AGENT_KEY)).toBe(SDK_GENERAL_PURPOSE_AGENT_KEY);
  expect(resolveSubagentSessionRole(SDK_PLAN_AGENT_KEY)).toBe(SDK_PLAN_AGENT_KEY);
});

test("resolveSubagentSessionRole rejects invalid agent types", () => {
  expect(resolveSubagentSessionRole("not a role")).toBeUndefined();
  expect(resolveSubagentSessionRole("")).toBeUndefined();
});
