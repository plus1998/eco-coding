/**
 * Desktop helper: spill oversized MCP text before Codex truncates it away.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  defaultCodexMcpToolOutputTokenLimits,
  spillOrTruncateMcpToolOutput,
} from "@eco/runtime";

export async function maybeSpillMcpTextContent(input: {
  text: string;
  serverName: string;
  toolName: string;
  threadId?: string;
  spillRootDir?: string;
  tokenLimit?: number;
}): Promise<{ text: string; spilled: boolean; artifactPath?: string }> {
  const defaults = defaultCodexMcpToolOutputTokenLimits(input.serverName);
  const tokenLimit =
    input.tokenLimit ??
    defaults?.[input.toolName] ??
    defaults?.[Object.keys(defaults ?? {})[0] ?? ""] ??
    10_000;
  const spillRoot =
    input.spillRootDir?.trim() ||
    path.join(os.tmpdir(), "eco-mcp-spills", sanitize(input.threadId ?? "global"));
  const result = await spillOrTruncateMcpToolOutput({
    text: input.text,
    spillDir: spillRoot,
    serverName: input.serverName,
    toolName: input.toolName,
    tokenLimit,
  });
  if (result.spilled && result.artifactPath) {
    // Ensure parent exists even if spill helper raced; ignore EEXIST-style races.
    await fs.mkdir(path.dirname(result.artifactPath), { recursive: true }).catch(() => undefined);
  }
  return {
    text: result.text,
    spilled: result.spilled,
    ...(result.artifactPath ? { artifactPath: result.artifactPath } : {}),
  };
}

function sanitize(value: string): string {
  return value.trim().replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 80) || "global";
}
