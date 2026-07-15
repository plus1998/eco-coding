import type {
  AgentDomain,
  AgentTemplate,
  BuiltInPresetDefinition,
  ToolPolicy,
} from "../shared/agent-orchestration";

export interface PresetTemplateImportPlan {
  templatesToSave: AgentTemplate[];
  templatesForProfile: AgentTemplate[];
  presetForProfile: BuiltInPresetDefinition;
  copiedTemplateIds: Record<string, string>;
}

export function buildPresetTemplateImportPlan(
  preset: BuiltInPresetDefinition,
  templates: readonly AgentTemplate[],
  options: { nowIso?: string } = {},
): PresetTemplateImportPlan {
  const nowIso = options.nowIso ?? new Date().toISOString();
  const templateById = new Map(templates.map((template) => [template.id, template]));
  const allocatedIds = new Set(templates.map((template) => template.id.trim()).filter(Boolean));
  const templatesToSave: AgentTemplate[] = [];
  const copiedTemplateIds: Record<string, string> = {};

  for (const templateId of uniquePresetTemplateIds(preset)) {
    const template = templateById.get(templateId);
    if (!template) {
      throw new Error(`场景预设 ${preset.name} 缺少子代理模板：${templateId}`);
    }

    const baseCopyId = createPresetTemplateCopyBaseId(preset.id, template.id);
    const reusable = findReusablePresetTemplateCopy(baseCopyId, templateById);
    if (reusable) {
      copiedTemplateIds[template.id] = reusable.id;
      continue;
    }

    const copyId = uniquePresetTemplateCopyId(baseCopyId, allocatedIds);
    allocatedIds.add(copyId);
    copiedTemplateIds[template.id] = copyId;
    templatesToSave.push({
      ...template,
      id: copyId,
      defaultTools: cloneToolPolicy(template.defaultTools),
      mcpServers: [...template.mcpServers],
      skills: [...template.skills],
      builtIn: false,
      source: "user",
      updatedAt: nowIso,
    });
  }

  return {
    templatesToSave,
    templatesForProfile: [...templates, ...templatesToSave],
    presetForProfile: {
      ...preset,
      defaultAgents: preset.defaultAgents.map((agent) => ({
        ...agent,
        templateId: copiedTemplateIds[agent.templateId] ?? agent.templateId,
      })),
    },
    copiedTemplateIds,
  };
}

export function createPresetTemplateCopyBaseId(presetId: AgentDomain, templateId: string): string {
  return `user.${presetId}.template.${templateId.trim().replace(/[^a-zA-Z0-9._-]+/g, "_")}`;
}

function uniquePresetTemplateIds(preset: BuiltInPresetDefinition): string[] {
  return Array.from(new Set(preset.defaultAgents.map((agent) => agent.templateId.trim()).filter(Boolean)));
}

function isReusablePresetTemplateCopy(template: AgentTemplate): boolean {
  return !template.builtIn && template.source !== "built_in" && template.source !== "derived";
}

function findReusablePresetTemplateCopy(
  baseId: string,
  templateById: ReadonlyMap<string, AgentTemplate>,
): AgentTemplate | undefined {
  const direct = templateById.get(baseId);
  if (direct && isReusablePresetTemplateCopy(direct)) {
    return direct;
  }
  for (let index = 2; index < 1000; index += 1) {
    const candidate = templateById.get(`${baseId}.${index}`);
    if (candidate && isReusablePresetTemplateCopy(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

function uniquePresetTemplateCopyId(baseId: string, allocatedIds: Set<string>): string {
  if (!allocatedIds.has(baseId)) {
    return baseId;
  }
  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${baseId}.${index}`;
    if (!allocatedIds.has(candidate)) {
      return candidate;
    }
  }
  throw new Error(`无法为 ${baseId} 生成唯一子代理模板 ID。`);
}

function cloneToolPolicy(policy: ToolPolicy): ToolPolicy {
  const cloned: ToolPolicy = {
    allowed: [...policy.allowed],
    disallowed: [...policy.disallowed],
  };
  if (policy.bash) {
    cloned.bash = { enabled: policy.bash.enabled };
  }
  if (policy.mcp) {
    cloned.mcp = {
      allowedServers: [...policy.mcp.allowedServers],
      allowedTools: [...policy.mcp.allowedTools],
    };
  }
  if (policy.filesystem) {
    cloned.filesystem = { ...policy.filesystem };
  }
  if (policy.network) {
    cloned.network = { ...policy.network };
  }
  if (policy.confirmation) cloned.confirmation = policy.confirmation;
  if (policy.skills) cloned.skills = { ...policy.skills };
  if (policy.interaction) cloned.interaction = { ...policy.interaction };
  if (policy.taskProgress) cloned.taskProgress = { ...policy.taskProgress };
  if (policy.delegation) {
    cloned.delegation = {
      ...policy.delegation,
      ...(policy.delegation.allowedAgents
        ? { allowedAgents: [...policy.delegation.allowedAgents] }
        : {}),
    };
  }
  if (policy.coreOverrides) {
    cloned.coreOverrides = {
      ...(policy.coreOverrides.claude
        ? { claude: { disallowedTools: [...policy.coreOverrides.claude.disallowedTools] } }
        : {}),
      ...(policy.coreOverrides.codex ? { codex: { ...policy.coreOverrides.codex } } : {}),
    };
  }
  return cloned;
}
