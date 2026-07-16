import { expect, test } from "bun:test";
import { formatUsageBreakdownAgentLabel } from "../src/renderer/UsageBreakdownPanel";

test("formatUsageBreakdownAgentLabel uses runtime agent names with instance id", () => {
  expect(
    formatUsageBreakdownAgentLabel("researcher", "agent_researcher_123456789", {
      researcher: "Research Lead",
    }),
  ).toBe("Research Lead · #23456789");
});

test("formatUsageBreakdownAgentLabel falls back to role labels", () => {
  expect(formatUsageBreakdownAgentLabel("coder", "agent_coder_123456789")).toBe("编码 · #23456789");
  expect(formatUsageBreakdownAgentLabel("vision", "vision:thread:abcdef12")).toBe("看图 · #abcdef12");
});
