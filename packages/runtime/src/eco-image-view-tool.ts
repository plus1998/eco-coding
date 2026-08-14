import path from "node:path";
import {
  ECO_IMAGE_VIEW_FULL_TOOL,
  ECO_IMAGE_VIEW_MCP_SERVER,
  ECO_IMAGE_VIEW_TOOL,
  isEcoImageViewToolName,
} from "./eco-image-view-names.js";

export {
  ECO_IMAGE_VIEW_FULL_TOOL,
  ECO_IMAGE_VIEW_MCP_SERVER,
  ECO_IMAGE_VIEW_TOOL,
  isEcoImageViewToolName,
} from "./eco-image-view-names.js";

const PI_MCP_PROXY_TOOL_NAMES = new Set(["mcp", "mcpscript", "mcp_tool"]);

export function resolveEcoImageViewToolCall(
  toolName: string | undefined,
  input: unknown,
): { name: string; path?: string } | undefined {
  const directPath = isEcoImageViewToolName(toolName) ? readAbsoluteImagePath(input) : undefined;
  if (isEcoImageViewToolName(toolName)) {
    return {
      name: toolName!.trim(),
      ...(directPath ? { path: directPath } : {}),
    };
  }

  const proxy = readPiMcpProxyImageViewCall(toolName, input);
  if (!proxy) {
    return undefined;
  }
  const nestedPath = readAbsoluteImagePath(proxy.args) ?? readAbsoluteImagePath(input);
  return {
    name: proxy.name,
    ...(nestedPath ? { path: nestedPath } : {}),
  };
}

export function readImageViewPathFromToolArgs(
  toolName: string | undefined,
  input: unknown,
): string | undefined {
  return resolveEcoImageViewToolCall(toolName, input)?.path;
}

/**
 * PI's `mcp` / `mcpScript` proxy first probes available servers/tools
 * (`search`, `action`, …) before calling a real MCP tool via `{ tool, args }`.
 */
export function resolvePiMcpProxyDiscoveryCall(
  toolName: string | undefined,
  input: unknown,
): { kind: "search" } | undefined {
  const proxyName = toolName?.trim().toLowerCase() ?? "";
  if (!PI_MCP_PROXY_TOOL_NAMES.has(proxyName) || !isRecord(input)) {
    return undefined;
  }
  const tool = typeof input.tool === "string" ? input.tool.trim() : "";
  if (tool) {
    return undefined;
  }
  return { kind: "search" };
}

function readPiMcpProxyImageViewCall(
  toolName: string | undefined,
  input: unknown,
): { name: string; args?: Record<string, unknown> } | undefined {
  const proxyName = toolName?.trim().toLowerCase() ?? "";
  if (!PI_MCP_PROXY_TOOL_NAMES.has(proxyName) || !isRecord(input)) {
    return undefined;
  }
  const tool = typeof input.tool === "string" ? input.tool.trim() : "";
  if (!tool) {
    return undefined;
  }
  const server = typeof input.server === "string" ? input.server.trim() : "";
  const reconstructed = server ? `mcp__${server}__${tool}` : tool;
  const isViewImage =
    isEcoImageViewToolName(reconstructed) ||
    isEcoImageViewToolName(tool) ||
    (tool.toLowerCase() === ECO_IMAGE_VIEW_TOOL &&
      (!server || server.toLowerCase().includes(ECO_IMAGE_VIEW_MCP_SERVER)));
  if (!isViewImage) {
    return undefined;
  }
  const args = readRecord(input.args) ?? readRecord(input.arguments);
  return {
    name:
      isEcoImageViewToolName(reconstructed) && reconstructed.startsWith("mcp__")
        ? reconstructed
        : ECO_IMAGE_VIEW_FULL_TOOL,
    ...(args ? { args } : {}),
  };
}

function readAbsoluteImagePath(input: unknown): string | undefined {
  if (!isRecord(input)) return undefined;
  const raw = input.path;
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  if (!trimmed || !path.isAbsolute(trimmed)) return undefined;
  return trimmed;
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value !== "string" || !value.trim()) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
