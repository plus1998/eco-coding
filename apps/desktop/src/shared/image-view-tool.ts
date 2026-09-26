import { ECO_IMAGE_VIEW_FULL_TOOL } from "@eco/runtime/eco-image-view-names";

export {
  ECO_IMAGE_VIEW_FULL_TOOL,
  ECO_IMAGE_VIEW_MCP_SERVER,
  ECO_IMAGE_VIEW_TOOL,
  isEcoImageViewToolName,
} from "@eco/runtime/eco-image-view-names";

export function buildImageViewPromptAppend(): string {
  return [
    "Built-in local image viewing (Eco) is always available.",
    `To inspect an image, call \`${ECO_IMAGE_VIEW_FULL_TOOL}\` with either an absolute path or a durable ref, plus the prompt you choose for this task.`,
    "The tool returns the vision model's text response; it does not impose a response schema. Keep image bytes out of the main prompt.",
    "Composer image references are included in the prompt when available. Choose the image-specific prompt yourself.",
    "On Codex, prefer this Eco tool over the native view_image when you need the Eco vision model; the native viewer may still appear.",
  ].join("\n");
}
