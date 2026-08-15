import type { AcpAgentId } from "@eco/runtime/core-runtime";

/**
 * Resolve ACP agent id for a thread. MVP: only `"cursor"`; missing defaults to cursor.
 */
export function resolveAcpThreadAgentId(thread: {
  acpAgentId?: string | undefined;
}): AcpAgentId {
  const raw = typeof thread.acpAgentId === "string" ? thread.acpAgentId.trim() : "";
  if (!raw || raw === "cursor") {
    return "cursor";
  }
  throw new Error(`Unsupported acpAgentId: ${raw}`);
}
