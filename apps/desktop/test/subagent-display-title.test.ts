import { expect, test } from "bun:test";
import { resolveSubagentRunDisplayTitle } from "../src/shared/subagent-roles";

test("resolves the vision subagent title through the locale translator", () => {
  expect(
    resolveSubagentRunDisplayTitle("vision", (key) => (key === "agent.role.vision" ? "Vision" : key)),
  ).toBe("Vision");
});
