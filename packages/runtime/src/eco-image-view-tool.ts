import path from "node:path";

export const ECO_IMAGE_VIEW_MCP_SERVER = "eco_image_view" as const;
export const ECO_IMAGE_VIEW_TOOL = "view_image" as const;
export const ECO_IMAGE_VIEW_FULL_TOOL =
  `mcp__${ECO_IMAGE_VIEW_MCP_SERVER}__${ECO_IMAGE_VIEW_TOOL}` as const;

export function isEcoImageViewToolName(value: string | undefined): boolean {
  const name = value?.trim().toLowerCase() ?? "";
  if (!name) return false;
  return name.includes(ECO_IMAGE_VIEW_MCP_SERVER);
}

export function readImageViewPathFromToolArgs(
  toolName: string | undefined,
  input: unknown,
): string | undefined {
  if (!isEcoImageViewToolName(toolName)) return undefined;
  if (!input || typeof input !== "object" || Array.isArray(input)) return undefined;
  const raw = (input as Record<string, unknown>).path;
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  if (!trimmed || !path.isAbsolute(trimmed)) return undefined;
  return trimmed;
}
