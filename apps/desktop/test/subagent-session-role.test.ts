import { expect, test } from "bun:test";
import { resolveSubagentSessionRole } from "../src/shared/subagent-roles";

test("resolveSubagentSessionRole maps eco_* dynamic agent keys", () => {
  expect(resolveSubagentSessionRole("eco_researcher")).toBe("researcher");
  expect(resolveSubagentSessionRole("researcher")).toBe("researcher");
  expect(resolveSubagentSessionRole("eco_coder")).toBe("coder");
});

test("resolveSubagentSessionRole rejects invalid agent types", () => {
  expect(resolveSubagentSessionRole("not a role")).toBeUndefined();
  expect(resolveSubagentSessionRole("")).toBeUndefined();
});
