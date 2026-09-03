export const ECO_WEB_SEARCH_MCP_SERVER = "eco_web_search";
export const ECO_WEB_SEARCH_TOOL = "search";
export const ECO_WEB_SEARCH_FULL_TOOL = `mcp__${ECO_WEB_SEARCH_MCP_SERVER}__${ECO_WEB_SEARCH_TOOL}`;

export function isEcoWebSearchToolName(name: string | undefined): boolean {
  const normalized = name?.trim().toLowerCase() ?? "";
  if (!normalized) {
    return false;
  }
  // Only match Eco's server id — bare `__search` collides with other MCP servers (claim routing).
  return normalized.includes(ECO_WEB_SEARCH_MCP_SERVER);
}

export function buildIntegratedWebSearchPromptAppend(providerLabel: string): string {
  return [
    "Web search for this session uses Eco Integrated search.",
    `Call \`${ECO_WEB_SEARCH_FULL_TOOL}\` with a \`query\` string (provider: ${providerLabel}).`,
    "Do not use the built-in provider-native WebSearch / web_search tool.",
  ].join(" ");
}
