export const ECO_MCP_HUB_MCP_SERVER = "eco_mcp";
export const ECO_MCP_HUB_SEARCH_TOOL = "search_tools";
export const ECO_MCP_HUB_CALL_TOOL = "call_tool";
export const ECO_MCP_HUB_SEARCH_FULL_TOOL =
  `mcp__${ECO_MCP_HUB_MCP_SERVER}__${ECO_MCP_HUB_SEARCH_TOOL}`;
export const ECO_MCP_HUB_CALL_FULL_TOOL =
  `mcp__${ECO_MCP_HUB_MCP_SERVER}__${ECO_MCP_HUB_CALL_TOOL}`;

/**
 * Explain the one-server Hub protocol to agents while keeping direct MCP
 * runtimes usable when they explicitly expose the built-in server.
 */
export function buildEcoMcpHubToolUsage(input: { server: string; tool?: string }): string {
  const server = input.server.trim();
  const tool = input.tool?.trim();
  const target = tool ? `${server}:${tool}` : server;
  const direct = tool ? `mcp__${server}__${tool}` : `mcp__${server}__*`;
  const query = tool ? target : server;
  return [
    `Use Eco MCP Hub for \`${target}\`: call \`${ECO_MCP_HUB_SEARCH_FULL_TOOL}\` with query \`${query}\`, then \`${ECO_MCP_HUB_CALL_FULL_TOOL}\` with the returned tool and put args under \`arguments\`.`,
    `Do not call \`${direct}\` unless explicitly listed; otherwise use the Hub.`,
  ].join(" ");
}
