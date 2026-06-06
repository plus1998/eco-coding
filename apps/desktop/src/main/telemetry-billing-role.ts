import { AGENT_ROLES, type AgentRole } from "../shared/ipc";

export function normalizeTelemetryBillingRole(role: string): AgentRole {
  if (role === "system" || role === "thinking" || role === "tool") {
    return "planner";
  }
  if (AGENT_ROLES.includes(role as AgentRole)) {
    return role as AgentRole;
  }
  return "planner";
}
