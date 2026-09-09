/**
 * Spill oversized MCP tool text to a local artifact and return a model-facing
 * preview. Addresses silent middle-truncation (openai/codex#14206 community ask).
 */
import fs from "node:fs/promises";
import path from "node:path";
import {
  approxTokenCount,
  DEFAULT_TOOL_OUTPUT_TOKEN_LIMIT,
  truncateMiddleWithTokenBudget,
} from "./codex-output-truncation.js";

export interface SpillMcpToolOutputInput {
  text: string;
  /** Directory that already belongs to the Eco/Codex thread workspace. */
  spillDir: string;
  serverName: string;
  toolName: string;
  /** Model-facing token budget before spill. */
  tokenLimit?: number;
  now?: () => Date;
}

export interface SpillMcpToolOutputResult {
  text: string;
  truncated: boolean;
  spilled: boolean;
  artifactPath?: string;
  originalTokenCount: number;
}

export async function spillOrTruncateMcpToolOutput(
  input: SpillMcpToolOutputInput,
): Promise<SpillMcpToolOutputResult> {
  const text = input.text;
  const tokenLimit = Math.max(1, Math.floor(input.tokenLimit ?? DEFAULT_TOOL_OUTPUT_TOKEN_LIMIT));
  const originalTokenCount = approxTokenCount(text);
  const truncated = truncateMiddleWithTokenBudget(text, tokenLimit);
  if (!truncated.truncated) {
    return {
      text,
      truncated: false,
      spilled: false,
      originalTokenCount,
    };
  }

  const stamp = (input.now?.() ?? new Date()).toISOString().replace(/[:.]/g, "-");
  const safeServer = sanitizePathSegment(input.serverName);
  const safeTool = sanitizePathSegment(input.toolName);
  const fileName = `${safeServer}__${safeTool}__${stamp}.txt`;
  const artifactPath = path.join(input.spillDir, fileName);
  await fs.mkdir(input.spillDir, { recursive: true });
  await fs.writeFile(artifactPath, text, "utf8");

  const preview = [
    `Warning: MCP tool output spilled to artifact (original token count: ${originalTokenCount}).`,
    `Full result path: ${artifactPath}`,
    `Server: ${input.serverName}`,
    `Tool: ${input.toolName}`,
    "",
    "Preview (middle-truncated):",
    truncated.text,
  ].join("\n");

  return {
    text: preview,
    truncated: true,
    spilled: true,
    artifactPath,
    originalTokenCount,
  };
}

function sanitizePathSegment(value: string): string {
  const trimmed = value.trim() || "unknown";
  return trimmed.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 64);
}
