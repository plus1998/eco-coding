import path from "node:path";
import type { McpSdkConfig } from "../shared/mcp";
import {
  filterMcpSdkConfigByAssignedServers,
  sanitizeMcpServerName,
} from "../shared/mcp";
import { ECO_AGENT_BROWSER_MCP_SERVER } from "../shared/browser";
import { ECO_IMAGE_GENERATION_MCP_SERVER } from "../shared/image-generation";
import { prepareMcpSdkConfigForRuntime } from "./mcp-runtime";

export type PiMcpSessionResolution = {
  mcpServers: Record<string, unknown>;
  appendSystemPrompt: string[];
  /** Absolute skill directories to merge into PI skillPaths (e.g. browser skill). */
  extraSkillDirectories: string[];
};

/**
 * Build isolated PI MCP config from Eco global store + Composer selection + integrations.
 * Mirrors Claude `buildSdkSessionOptions` filtering, without ambient .mcp.json.
 */
export function buildPiMcpSessionConfig(input: {
  globalSdkConfig: McpSdkConfig;
  enabledMcpServerKeys: readonly string[];
  browserInject: {
    enabled: boolean;
    sdkEntry?: Record<string, unknown>;
    promptAppend?: string;
  };
  imageInject: {
    enabled: boolean;
    sdkEntry?: Record<string, unknown>;
    promptAppend?: string;
  };
  /** Absolute directory containing eco-agent-browser SKILL.md when browser is enabled. */
  browserSkillDirectory?: string;
}): PiMcpSessionResolution {
  const assignedUserKeys = input.enabledMcpServerKeys
    .map((key) => sanitizeMcpServerName(key))
    .filter(
      (key) =>
        key !== ECO_AGENT_BROWSER_MCP_SERVER &&
        !key.startsWith("eco_ab_") &&
        key !== ECO_IMAGE_GENERATION_MCP_SERVER,
    );

  const filtered = filterMcpSdkConfigByAssignedServers(
    input.globalSdkConfig,
    assignedUserKeys,
  );

  const mcpServers: Record<string, unknown> = { ...filtered.mcpServers };
  const appendSystemPrompt: string[] = [];
  const extraSkillDirectories: string[] = [];

  if (input.browserInject.enabled && input.browserInject.sdkEntry) {
    mcpServers[ECO_AGENT_BROWSER_MCP_SERVER] = input.browserInject.sdkEntry;
    if (input.browserInject.promptAppend?.trim()) {
      appendSystemPrompt.push(input.browserInject.promptAppend.trim());
    }
    if (input.browserSkillDirectory?.trim()) {
      extraSkillDirectories.push(path.resolve(input.browserSkillDirectory.trim()));
    }
  }

  if (input.imageInject.enabled && input.imageInject.sdkEntry) {
    mcpServers[ECO_IMAGE_GENERATION_MCP_SERVER] = input.imageInject.sdkEntry;
    if (input.imageInject.promptAppend?.trim()) {
      appendSystemPrompt.push(input.imageInject.promptAppend.trim());
    }
  }

  const runtime = prepareMcpSdkConfigForRuntime({
    mcpServers,
    allowedTools: filtered.allowedTools,
  });

  return {
    mcpServers: runtime.mcpServers,
    appendSystemPrompt,
    extraSkillDirectories: [...new Set(extraSkillDirectories)].sort((a, b) =>
      a.localeCompare(b),
    ),
  };
}
