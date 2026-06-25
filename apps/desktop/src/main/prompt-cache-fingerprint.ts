import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

export type PromptCacheBreakReason = "profile_changed" | "mcp_servers_changed" | "claude_md_changed";

export interface PromptCacheFingerprint {
  profileId: string;
  mcpServerKeys: string[];
  claudeMdDigest: string;
}

export function buildPromptCacheFingerprint(input: {
  profileId: string;
  mcpServerKeys: readonly string[];
  claudeMdDigest: string;
}): PromptCacheFingerprint {
  return {
    profileId: input.profileId.trim(),
    mcpServerKeys: [...input.mcpServerKeys].map((key) => key.trim()).filter(Boolean).sort(),
    claudeMdDigest: input.claudeMdDigest.trim(),
  };
}

export function diffPromptCacheFingerprint(
  before: PromptCacheFingerprint,
  after: PromptCacheFingerprint,
): PromptCacheBreakReason[] {
  const reasons: PromptCacheBreakReason[] = [];
  if (before.profileId !== after.profileId) {
    reasons.push("profile_changed");
  }
  if (!stringArraysEqual(before.mcpServerKeys, after.mcpServerKeys)) {
    reasons.push("mcp_servers_changed");
  }
  if (before.claudeMdDigest !== after.claudeMdDigest) {
    reasons.push("claude_md_changed");
  }
  return reasons;
}

export function formatPromptCacheBreakMessage(reasons: readonly PromptCacheBreakReason[]): string {
  if (reasons.length === 0) {
    return "本会话 prompt cache 已失效";
  }
  const parts: string[] = [];
  if (reasons.includes("profile_changed")) {
    parts.push("Agent Profile");
  }
  if (reasons.includes("mcp_servers_changed")) {
    parts.push("MCP 配置");
  }
  if (reasons.includes("claude_md_changed")) {
    parts.push("CLAUDE.md");
  }
  return `${parts.join("与")}已变更，本会话 prompt cache 已失效`;
}

export function formatPromptCacheBreakLog(reasons: readonly PromptCacheBreakReason[]): string {
  return reasons.length > 0 ? reasons.join(",") : "unknown";
}

export async function resolveClaudeMdDigest(input: {
  workspacePath?: string;
  userHomeDir: string;
  includeUserSource: boolean;
}): Promise<string> {
  const paths: string[] = [];
  const workspacePath = input.workspacePath?.trim();
  if (workspacePath) {
    paths.push(path.join(workspacePath, "CLAUDE.md"));
    paths.push(path.join(workspacePath, ".claude", "CLAUDE.md"));
  }
  if (input.includeUserSource) {
    paths.push(path.join(input.userHomeDir, ".claude", "CLAUDE.md"));
  }
  return digestClaudeMdFiles(paths);
}

async function digestClaudeMdFiles(paths: readonly string[]): Promise<string> {
  const parts: string[] = [];
  for (const filePath of paths) {
    try {
      const content = await readFile(filePath, "utf8");
      parts.push(`${filePath}\n${content}`);
    } catch {
      parts.push(`${filePath}\n<missing>`);
    }
  }
  if (parts.length === 0) {
    return "none";
  }
  return createHash("sha256").update(parts.join("\n---\n"), "utf8").digest("hex").slice(0, 16);
}

function stringArraysEqual(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((value, index) => value === right[index]);
}
