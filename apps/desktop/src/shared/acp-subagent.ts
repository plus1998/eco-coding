/** Matches `@eco/runtime` `ACP_SUBAGENT_AGENT_ID_PREFIX` / `acpSubagentAgentId`. */
export const ACP_SUBAGENT_AGENT_ID_PREFIX = "acp-sub:";

/** Cursor ACP nested subagent Cards are minted from `cursor/task` as `acp-sub:*`. */
export function isAcpSubagentAgentId(agentId: string | undefined | null): boolean {
  const id = typeof agentId === "string" ? agentId.trim() : "";
  return id.startsWith(ACP_SUBAGENT_AGENT_ID_PREFIX);
}
