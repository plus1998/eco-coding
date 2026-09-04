import { ECO_HTML_HOST_FULL_TOOL } from "@eco/runtime/eco-html-host-names";

export {
  ECO_HTML_HOST_FULL_TOOL,
  ECO_HTML_HOST_MCP_SERVER,
  ECO_HTML_HOST_TOOL,
  isEcoHtmlHostToolName,
} from "@eco/runtime/eco-html-host-names";

export function buildHtmlHostPromptAppend(): string {
  return [
    "Built-in HTML page hosting (Eco Artifacts) is available when Supabase Center is connected and html-host Edge Functions are deployed.",
    `To publish a progress / report / stats page, use only \`${ECO_HTML_HOST_FULL_TOOL}\`.`,
    "Provide a short `title` and a single self-contained `html` document (inline CSS/JS). Do not draw the Eco chrome / top bar — Eco wraps your content.",
    "Optional `pageId` updates an existing page's content without resetting TTL.",
    "On success the tool returns `{ status: \"ok\", pageId, publicUrl, expiresAt, canExtend }`. Tell the user they can open or copy the link from the Feed card.",
    "Default retention is 7 days; viewers can extend once (+7 days) from the page. Do not invent share URLs.",
    "Note: on Supabase Cloud without a Custom Domain, shared-domain links may be served as text/plain and fail to render in external browsers — still publish; warn the user if relevant.",
  ].join("\n");
}
