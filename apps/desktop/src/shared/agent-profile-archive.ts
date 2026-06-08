import type { OrchestrationProfile } from "./agent-orchestration";

export const AGENT_PROFILE_ARCHIVE_SCHEMA = "eco.agentProfiles.v1";

export interface AgentProfileArchive {
  schema: typeof AGENT_PROFILE_ARCHIVE_SCHEMA;
  exportedAt: string;
  profiles: OrchestrationProfile[];
}

export function buildAgentProfileArchive(
  profiles: readonly OrchestrationProfile[],
  exportedAt = new Date().toISOString(),
): AgentProfileArchive {
  return {
    schema: AGENT_PROFILE_ARCHIVE_SCHEMA,
    exportedAt,
    profiles: profiles.map((profile) => ({ ...profile })),
  };
}

export function parseAgentProfileArchive(value: string): OrchestrationProfile[] {
  const parsed = JSON.parse(value) as unknown;
  if (Array.isArray(parsed)) {
    return parsed as OrchestrationProfile[];
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("导入文件必须是 JSON 对象或数组。");
  }
  const record = parsed as Record<string, unknown>;
  if (record.schema === AGENT_PROFILE_ARCHIVE_SCHEMA && Array.isArray(record.profiles)) {
    return record.profiles as OrchestrationProfile[];
  }
  if (Array.isArray(record.profiles)) {
    return record.profiles as OrchestrationProfile[];
  }
  if (typeof record.id === "string") {
    return [record as unknown as OrchestrationProfile];
  }
  throw new Error("导入文件没有包含 Agent Profiles。");
}
