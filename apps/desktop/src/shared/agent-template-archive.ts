import type { AgentTemplate } from "./agent-orchestration";

export const AGENT_TEMPLATE_ARCHIVE_SCHEMA = "eco.agentTemplates.v1";

export interface AgentTemplateArchive {
  schema: typeof AGENT_TEMPLATE_ARCHIVE_SCHEMA;
  exportedAt: string;
  templates: AgentTemplate[];
}

export function buildAgentTemplateArchive(
  templates: readonly AgentTemplate[],
  exportedAt = new Date().toISOString(),
): AgentTemplateArchive {
  return {
    schema: AGENT_TEMPLATE_ARCHIVE_SCHEMA,
    exportedAt,
    templates: templates.map((template) => ({ ...template })),
  };
}

export function parseAgentTemplateArchive(value: string): AgentTemplate[] {
  const parsed = JSON.parse(value) as unknown;
  if (Array.isArray(parsed)) {
    return parsed as AgentTemplate[];
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("导入文件必须是 JSON 对象或数组。");
  }
  const record = parsed as Record<string, unknown>;
  if (record.schema === AGENT_TEMPLATE_ARCHIVE_SCHEMA && Array.isArray(record.templates)) {
    return record.templates as AgentTemplate[];
  }
  if (Array.isArray(record.templates)) {
    return record.templates as AgentTemplate[];
  }
  if (typeof record.id === "string") {
    return [record as unknown as AgentTemplate];
  }
  throw new Error("导入文件没有包含 agent templates。");
}
