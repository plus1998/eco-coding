import { expect, test } from "bun:test";
import {
  formatSubagentMissionMessage,
  parseSubagentMissionMessage,
  summarizeAgentObjective,
} from "../src/agent-mission";

test("summarizes reviewer objective from changed files", () => {
  const summary = summarizeAgentObjective(
    "reviewer",
    "Review the implementation against the approved plan.\nFiles changed: src/api.ts, src/hooks/useApi.ts",
  );
  expect(summary).toContain("src/api.ts");
});

test("round-trips mission messages", () => {
  const message = formatSubagentMissionMessage("reviewer", "Review export filters in src/api.ts");
  const parsed = parseSubagentMissionMessage(message);
  expect(parsed?.role).toBe("reviewer");
  expect(parsed?.summary.length).toBeGreaterThan(0);
  expect(parsed?.prompt).toContain("src/api.ts");
});
