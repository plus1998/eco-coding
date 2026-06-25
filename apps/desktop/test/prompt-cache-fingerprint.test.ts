import { expect, test } from "bun:test";
import {
  buildPromptCacheFingerprint,
  diffPromptCacheFingerprint,
  formatPromptCacheBreakMessage,
} from "../src/main/prompt-cache-fingerprint";

test("diffPromptCacheFingerprint detects profile, mcp, and claude.md changes", () => {
  const baseline = buildPromptCacheFingerprint({
    profileId: "profile-a",
    mcpServerKeys: ["github", "mongo"],
    claudeMdDigest: "abc123",
  });
  expect(
    diffPromptCacheFingerprint(
      baseline,
      buildPromptCacheFingerprint({
        profileId: "profile-b",
        mcpServerKeys: ["github", "mongo"],
        claudeMdDigest: "abc123",
      }),
    ),
  ).toEqual(["profile_changed"]);
  expect(
    diffPromptCacheFingerprint(
      baseline,
      buildPromptCacheFingerprint({
        profileId: "profile-a",
        mcpServerKeys: ["github"],
        claudeMdDigest: "abc123",
      }),
    ),
  ).toEqual(["mcp_servers_changed"]);
  expect(
    diffPromptCacheFingerprint(
      baseline,
      buildPromptCacheFingerprint({
        profileId: "profile-a",
        mcpServerKeys: ["github", "mongo"],
        claudeMdDigest: "def456",
      }),
    ),
  ).toEqual(["claude_md_changed"]);
});

test("formatPromptCacheBreakMessage combines multiple reasons", () => {
  expect(formatPromptCacheBreakMessage(["mcp_servers_changed", "claude_md_changed"])).toBe(
    "MCP 配置与CLAUDE.md已变更，本会话 prompt cache 已失效",
  );
});
