import { ECO_IMAGE_VIEW_FULL_TOOL } from "@eco/runtime";

export {
  ECO_IMAGE_VIEW_FULL_TOOL,
  ECO_IMAGE_VIEW_MCP_SERVER,
  ECO_IMAGE_VIEW_TOOL,
  isEcoImageViewToolName,
} from "@eco/runtime";

export function buildImageViewPromptAppend(): string {
  return [
    "Built-in local image viewing (Eco) is always available.",
    `To inspect a local image file, use only \`${ECO_IMAGE_VIEW_FULL_TOOL}\` with an absolute path.`,
    "The tool returns a structured text report, not pixels. Do not attach image bytes to the main conversation.",
    "On Codex, prefer this Eco tool over the native view_image when you need the Eco vision model; the native viewer may still appear.",
  ].join("\n");
}
