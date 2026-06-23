import type { AgentTemplate, OrchestrationProfile } from "./agent-orchestration";

export const AGENT_PROFILE_ARCHIVE_SCHEMA = "eco.agentProfiles.v1";

export interface AgentProfileArchive {
  schema: typeof AGENT_PROFILE_ARCHIVE_SCHEMA;
  exportedAt: string;
  profiles: OrchestrationProfile[];
  templates?: AgentTemplate[];
}

export interface AgentProfileArchiveBundle {
  profiles: OrchestrationProfile[];
  templates: AgentTemplate[];
}

export function buildAgentProfileArchive(
  profiles: readonly OrchestrationProfile[],
  exportedAt = new Date().toISOString(),
  options: { templates?: readonly AgentTemplate[] } = {},
): AgentProfileArchive {
  return {
    schema: AGENT_PROFILE_ARCHIVE_SCHEMA,
    exportedAt,
    profiles: profiles.map((profile) => ({ ...profile })),
    ...(options.templates && options.templates.length > 0
      ? { templates: options.templates.map((template) => ({ ...template })) }
      : {}),
  };
}

export function parseAgentProfileArchive(value: string): OrchestrationProfile[] {
  return parseAgentProfileArchiveBundle(value).profiles;
}

export function parseAgentProfileArchiveBundle(value: string): AgentProfileArchiveBundle {
  const parsed = JSON.parse(value) as unknown;
  if (Array.isArray(parsed)) {
    return { profiles: parsed as OrchestrationProfile[], templates: [] };
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("导入文件必须是 JSON 对象或数组。");
  }
  const record = parsed as Record<string, unknown>;
  if (record.schema === AGENT_PROFILE_ARCHIVE_SCHEMA && Array.isArray(record.profiles)) {
    return {
      profiles: record.profiles as OrchestrationProfile[],
      templates: Array.isArray(record.templates) ? (record.templates as AgentTemplate[]) : [],
    };
  }
  if (Array.isArray(record.profiles)) {
    return {
      profiles: record.profiles as OrchestrationProfile[],
      templates: Array.isArray(record.templates) ? (record.templates as AgentTemplate[]) : [],
    };
  }
  if (typeof record.id === "string") {
    return { profiles: [record as unknown as OrchestrationProfile], templates: [] };
  }
  throw new Error("导入文件没有包含智能体配置。");
}
