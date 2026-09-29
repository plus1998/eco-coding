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

/**
 * Rewrite the fixed Hub wrapper tool names for one Codex thread's prompt.
 *
 * SDK runtimes register the Hub under the fixed name `eco_mcp`, so the
 * builders above are correct for them. Codex is different: every Eco thread
 * shares one Codex app-server and one process-global MCP config pool, and
 * each pool entry must carry its own per-thread bearer token, so the Hub is
 * registered under a unique per-thread server name (`codexHubServerName`).
 * Leaving the fixed names in a Codex thread prompt makes them disagree with
 * the Codex tool registry; local models then copy bare `call_tool` /
 * `search_tools` names without a namespace and Codex rejects them as
 * `unsupported call`.
 */
export function rewriteEcoMcpHubPromptForCodexServer(
  text: string | undefined,
  codexHubServer: string,
): string | undefined {
  if (!text) return text;
  const server = codexHubServer.trim();
  if (!server || server === ECO_MCP_HUB_MCP_SERVER) return text;
  const fixedPrefix = `mcp__${ECO_MCP_HUB_MCP_SERVER}__`;
  if (!text.includes(fixedPrefix)) return text;
  return text.split(fixedPrefix).join(`mcp__${server}__`);
}
