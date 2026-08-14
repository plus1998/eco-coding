import path from "node:path";
import { isEcoImageViewToolName } from "./eco-image-view-names.js";

export {
  ECO_IMAGE_VIEW_FULL_TOOL,
  ECO_IMAGE_VIEW_MCP_SERVER,
  ECO_IMAGE_VIEW_TOOL,
  isEcoImageViewToolName,
} from "./eco-image-view-names.js";

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
