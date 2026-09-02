import { ECO_IMAGE_DISPLAY_FULL_TOOL } from "@eco/runtime/eco-image-display-names";
import { ECO_IMAGE_VIEW_FULL_TOOL } from "@eco/runtime/eco-image-view-names";

export {
  ECO_IMAGE_DISPLAY_FULL_TOOL,
  ECO_IMAGE_DISPLAY_MCP_SERVER,
  ECO_IMAGE_DISPLAY_TOOL,
  isEcoImageDisplayToolName,
} from "@eco/runtime/eco-image-display-names";

export function buildImageDisplayPromptAppend(): string {
  return [
    "Built-in image display for the user (Eco) is always available.",
    `To show the user an image in the conversation feed, use only \`${ECO_IMAGE_DISPLAY_FULL_TOOL}\`.`,
    "Supported sources: absolute local path (`source: path`), HTTPS URL (`source: url`), or base64 bytes (`source: base64` with `data` + optional `mimeType`).",
    "The tool stores the image as a feed artifact and returns `{ artifactId }` text — do not paste large base64 into narrative replies.",
    `To analyze an image for yourself (vision report), use \`${ECO_IMAGE_VIEW_FULL_TOOL}\` instead of display_image.`,
  ].join("\n");
}
