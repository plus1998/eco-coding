import { expect, test } from "bun:test";
import {
  buildPromptCacheFingerprint,
  diffPromptCacheFingerprint,
  formatPromptCacheBreakMessage,
} from "../src/main/prompt-cache-fingerprint";

test("diffPromptCacheFingerprint detects orchestration, mcp, and claude.md changes", () => {
  const baseline = buildPromptCacheFingerprint({
    orchestrationKey: "orchestration-a",
    mainAgentModelKey: '["p1","m1","high"]',
    mcpServerKeys: ["github", "mongo"],
    claudeMdDigest: "abc123",
  });
  expect(
    diffPromptCacheFingerprint(
      baseline,
      buildPromptCacheFingerprint({
        orchestrationKey: "orchestration-b",
        mainAgentModelKey: '["p1","m1","high"]',
        mcpServerKeys: ["github", "mongo"],
        claudeMdDigest: "abc123",
      }),
    ),
  ).toEqual(["orchestration_changed"]);
  expect(
    diffPromptCacheFingerprint(
      baseline,
      buildPromptCacheFingerprint({
        orchestrationKey: "orchestration-a",
        mainAgentModelKey: '["p1","m1","high"]',
        mcpServerKeys: ["github"],
        claudeMdDigest: "abc123",
      }),
    ),
  ).toEqual(["mcp_servers_changed"]);
  expect(
    diffPromptCacheFingerprint(
      baseline,
      buildPromptCacheFingerprint({
        orchestrationKey: "orchestration-a",
        mainAgentModelKey: '["p1","m1","high"]',
        mcpServerKeys: ["github", "mongo"],
        claudeMdDigest: "def456",
      }),
    ),
  ).toEqual(["claude_md_changed"]);
  expect(
    diffPromptCacheFingerprint(
      baseline,
      buildPromptCacheFingerprint({
        orchestrationKey: "orchestration-a",
        mainAgentModelKey: '["p1","m1","xhigh"]',
        mcpServerKeys: ["github", "mongo"],
        claudeMdDigest: "abc123",
      }),
    ),
  ).toEqual(["main_agent_model_changed"]);
  expect(
    diffPromptCacheFingerprint(
      baseline,
      buildPromptCacheFingerprint({
        orchestrationKey: "orchestration-b",
        mainAgentModelKey: '["p2","m2","xhigh"]',
        mcpServerKeys: ["github", "mongo"],
        claudeMdDigest: "abc123",
      }),
    ),
  ).toEqual(["orchestration_changed", "main_agent_model_changed"]);
});

test("formatPromptCacheBreakMessage combines multiple reasons", () => {
  expect(formatPromptCacheBreakMessage(["mcp_servers_changed", "claude_md_changed"])).toBe(
    "MCP 配置已变更，CLAUDE.md 已变更，本会话 prompt cache 已失效",
  );
  expect(
    formatPromptCacheBreakMessage(["orchestration_changed"], {
      orchestrationLabel: { modelStack: "GPT+DeepSeek", orchestrationName: "Composer" },
    }),
  ).toBe("已经变更为 GPT+DeepSeek（Composer），本会话 prompt cache 已失效");
  expect(formatPromptCacheBreakMessage(["main_agent_model_changed"])).toBe(
    "主代理模型或思考强度已变更，本会话 prompt cache 已失效",
  );
});
