import { expect, test } from "bun:test";
import {
  formatSubagentMissionMessage,
  isGenericMissionSummary,
  isWeakAgentToolDetail,
  parseSubagentMissionMessage,
  resolveMissionDisplayText,
  summarizeAgentObjective,
  missionFromAgentToolDetail,
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

test("round-trips optional agentId in mission messages", () => {
  const message = formatSubagentMissionMessage("coder", "Implement billing", {
    agentId: "agent_billing",
  });
  expect(parseSubagentMissionMessage(message)?.agentId).toBe("agent_billing");
});

test("resolveMissionDisplayText unwraps @mission payloads", () => {
  const message = formatSubagentMissionMessage("coder", "Implement login flow");
  expect(resolveMissionDisplayText(message)).toBe("Implement login flow");
  expect(resolveMissionDisplayText("Plain task prompt")).toBe("Plain task prompt");
});

test("ignores elapsed duration in agent tool detail", () => {
  expect(missionFromAgentToolDetail("(32.5s)")).toBeNull();
  expect(missionFromAgentToolDetail("32.5s")).toBeNull();
});

test("detects generic mission summaries and weak agent tool labels", () => {
  expect(isGenericMissionSummary("实现计划中的开发任务")).toBe(true);
  expect(isGenericMissionSummary("实现：Wire IPC")).toBe(false);
  expect(isWeakAgentToolDetail("编码 (coder)")).toBe(true);
  expect(isWeakAgentToolDetail("Implement export filters in src/api.ts")).toBe(false);
});

test("normalizes explore labels in agent tool detail", () => {
  expect(missionFromAgentToolDetail("探索 · 搜索代码库")?.role).toBe("explore");
  expect(missionFromAgentToolDetail("编码 (Explore)")?.role).toBe("Explore");
});
