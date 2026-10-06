import { ECO_IMAGE_DISPLAY_FULL_TOOL } from "@eco/runtime/eco-image-display-names";
import { buildEcoMcpHubToolUsage } from "./mcp-hub-tool-usage";

export {
  ECO_IMAGE_DISPLAY_FULL_TOOL,
  ECO_IMAGE_DISPLAY_MCP_SERVER,
  ECO_IMAGE_DISPLAY_TOOL,
  isEcoImageDisplayToolName,
} from "@eco/runtime/eco-image-display-names";

export function buildImageDisplayPromptAppend(): string {
  return [
    "Built-in image display for the user (Eco) is always available.",
    buildEcoMcpHubToolUsage({ server: "eco_image_display", tool: "display_image" }),
    `When the direct tool \`${ECO_IMAGE_DISPLAY_FULL_TOOL}\` is explicitly listed, use it to show the user an image.`,
    "Supported sources: absolute local path (`source: path`), HTTPS URL (`source: url`), or base64 bytes (`source: base64` with `data` + optional `mimeType`).",
    "On success the tool returns `{ status: \"ok\" }`. Eco shows the image in the workspace cards panel and task sidebar — tell the user they can open it there.",
    "Do not paste base64 into narrative replies, and do not invent Markdown image links such as `![...](artifact:...)` or `![...](file://...)`.",
    buildEcoMcpHubToolUsage({ server: "eco_image_view", tool: "view_image" }),
    "To analyze an image for yourself (vision report), use Eco's image viewing tool through the Hub instead of display_image.",
  ].join("\n");
}
