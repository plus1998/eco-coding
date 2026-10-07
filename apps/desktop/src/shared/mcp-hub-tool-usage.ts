export const ECO_MCP_HUB_MCP_SERVER = "eco_mcp";
export const ECO_MCP_HUB_SEARCH_TOOL = "search_tools";
export const ECO_MCP_HUB_CALL_TOOL = "call_tool";
export const ECO_MCP_HUB_SEARCH_FULL_TOOL = `mcp__${ECO_MCP_HUB_MCP_SERVER}__${ECO_MCP_HUB_SEARCH_TOOL}`;
export const ECO_MCP_HUB_CALL_FULL_TOOL = `mcp__${ECO_MCP_HUB_MCP_SERVER}__${ECO_MCP_HUB_CALL_TOOL}`;
const ECO_MCP_HUB_PROTOCOL_PROMPT = `Eco MCP Hub: call \`${ECO_MCP_HUB_SEARCH_FULL_TOOL}\` with the target as query, then \`${ECO_MCP_HUB_CALL_FULL_TOOL}\` with the returned tool and args under \`arguments\`.`;

/**
 * Explain the one-server Hub protocol to agents while keeping direct MCP
 * runtimes usable when they explicitly expose the built-in server.
 */
export function buildEcoMcpHubToolUsage(input: { server: string; tool?: string }): string {
  const server = input.server.trim();
  const tool = input.tool?.trim();
  const target = tool ? `${server}:${tool}` : server;
  const direct = tool ? `mcp__${server}__${tool}` : `mcp__${server}__*`;
  return [
    ECO_MCP_HUB_PROTOCOL_PROMPT,
    `Hub target: \`${target}\`. Do not call \`${direct}\` unless explicitly listed.`,
  ].join("\n");
}

/** Keep one copy of Eco's Hub protocol, without deduplicating user-authored rules. */
export function mergeEcoMcpHubPromptParts(parts: readonly (string | undefined)[]): string[] {
  let hasProtocol = false;
  return parts.flatMap((part) => {
    const text = part?.trim();
    if (!text) return [];
    const merged = text
      .split("\n")
      .filter((line) => {
        if (line !== ECO_MCP_HUB_PROTOCOL_PROMPT) return true;
        if (hasProtocol) return false;
        hasProtocol = true;
        return true;
      })
      .join("\n")
      .trim();
    return merged ? [merged] : [];
  });
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
