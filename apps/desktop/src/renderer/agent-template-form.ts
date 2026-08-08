import type {
  AgentTemplate,
  ToolPolicy,
} from "../shared/ipc";
import { formatList, parseList, uniqueValues } from "./agent-template-form-utils";
import {
  buildCapabilityPermissionChips,
  capabilityFieldsToToolPolicy,
  createDefaultToolCapabilityFields,
  isDelegationToolName,
  isGroupedCapabilityToolName,
  stripGroupedToolsFromDisallowed,
  toolPolicyToCapabilityFields,
  type ToolCapabilityFieldValues,
} from "./tool-capability-groups";
import { i18n } from "./i18n";

export type { ToolCapabilityFieldValues };
export {
  DELEGATION_TOOL_NAMES,
  isDelegationToolName,
  TOOL_CAPABILITY_PRESETS,
} from "./tool-capability-groups";
export { parseList, formatList } from "./agent-template-form-utils";

export interface AgentTemplateFormState extends ToolCapabilityFieldValues {
  id: string;
  name: string;
  description: string;
  prompt: string;
  whenToUse: string;
  outputContract: string;
}

export interface AgentTemplateCapabilityOption {
  value: string;
  label: string;
  description?: string;
  sourceLabel: string;
  disabled?: boolean;
}

export interface AgentTemplateCapabilityOptions {
  tools: AgentTemplateCapabilityOption[];
}

export type AgentTemplatePermissionTone = "allow" | "deny" | "warn" | "neutral";

export interface AgentTemplatePermissionChip {
  label: string;
  tone: AgentTemplatePermissionTone;
}

export function createBlankAgentTemplateForm(
  existingTemplates: readonly AgentTemplate[] = [],
): AgentTemplateFormState {
  return {
    id: createUniqueTemplateId(
      "user.custom.agent",
      existingTemplates.map((template) => template.id),
    ),
    name: "",
    description: "",
    prompt: "",
    whenToUse: "",
    outputContract: "",
    ...createDefaultToolCapabilityFields(),
  };
}

export function agentTemplateToForm(template: AgentTemplate): AgentTemplateFormState {
  const capability = toolPolicyToCapabilityFields(template.defaultTools, {
    allowDelegation: template.allowDelegation,
  });
  return {
    id: template.id,
    name: template.name,
    description: template.description,
    prompt: template.prompt,
    whenToUse: template.whenToUse,
    outputContract: template.outputContract ?? "",
    ...capability,
  };
}

export function createCopiedAgentTemplateForm(
  template: AgentTemplate,
  existingTemplates: readonly AgentTemplate[],
): AgentTemplateFormState {
  const form = agentTemplateToForm(template);
  const baseId = `user.custom.${slugifyTemplateId(template.name) || "agent"}`;
  return {
    ...form,
    id: createUniqueTemplateId(
      baseId,
      existingTemplates.map((entry) => entry.id),
    ),
    name: `${template.name} Copy`,
  };
}

export function buildAgentTemplateFromForm(
  form: AgentTemplateFormState,
  options: { existing?: AgentTemplate | undefined; nowIso?: string | undefined } = {},
): AgentTemplate {
  const id = requireTemplateField(form.id, i18n.t("agent.template.id"));
  if (id.startsWith("builtin.")) {
    throw new Error(i18n.t("agent.template.builtinId"));
  }
  if (!/^[a-zA-Z0-9_.-]+$/.test(id)) {
    throw new Error(i18n.t("agent.template.invalidId"));
  }
  const name = requireTemplateField(form.name, i18n.t("agent.template.name"));
  const description = requireTemplateField(form.description, i18n.t("agent.template.description"));
  const whenToUse = requireTemplateField(form.whenToUse, i18n.t("agent.template.whenToUse"));
  const prompt = requireTemplateField(form.prompt, i18n.t("agent.template.prompt"));
  const defaultTools = capabilityFieldsToToolPolicy(form);
  return {
    id,
    name,
    description,
    prompt,
    whenToUse,
    ...(form.outputContract.trim() ? { outputContract: form.outputContract.trim() } : {}),
    defaultTools,
    mcpServers: [],
    skills: [],
    allowDelegation: form.allowDelegation,
    builtIn: false,
    source: "user",
    updatedAt: options.nowIso ?? new Date().toISOString(),
  };
}

export function createUniqueTemplateId(baseId: string, existingIds: readonly string[]): string {
  const existing = new Set(existingIds);
  let candidate = baseId;
  let suffix = 2;
  while (existing.has(candidate)) {
    candidate = `${baseId}_${suffix}`;
    suffix += 1;
  }
  return candidate;
}

export function formatAgentSource(template: AgentTemplate): string {
  if (template.builtIn || template.source === "built_in") {
    return i18n.t("agent.source.builtin");
  }
  if (template.source === "derived") {
    return i18n.t("agent.source.derived");
  }
  return i18n.t("agent.source.user");
}

export function toggleAgentTemplateListValue(raw: string, value: string, checked: boolean): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return formatList(parseList(raw));
  }
  const values = parseList(raw).filter((entry) => entry !== trimmed);
  if (checked) {
    values.push(trimmed);
  }
  return formatList(uniqueValues(values));
}

export function toggleAgentTemplateAdvancedDisallowedTool(
  advancedDisallowedTools: string,
  value: string,
  checked: boolean,
): string {
  const tool = value.trim();
  if (!tool || isGroupedCapabilityToolName(tool)) {
    return stripGroupedToolsFromDisallowed(advancedDisallowedTools);
  }
  const disallowed = parseList(advancedDisallowedTools).filter((entry) => entry !== tool);
  if (checked) {
    disallowed.push(tool);
  }
  return formatList(uniqueValues(disallowed));
}

export function buildAgentTemplateCapabilityOptions(input: {
  templates: readonly AgentTemplate[];
  form?: Pick<ToolCapabilityFieldValues, "advancedDisallowedTools">;
}): AgentTemplateCapabilityOptions {
  const form = input.form;
  return {
    tools: buildAdvancedToolOptions(input.templates, form?.advancedDisallowedTools),
  };
}

export function normalizeDisallowedTools(policy: ToolPolicy): string[] {
  const disallowed = new Set(policy.disallowed.map((entry) => entry.trim()).filter(Boolean));
  if (policy.bash?.enabled === false) {
    disallowed.add("Bash");
  }
  if (policy.network?.webSearch === false) {
    disallowed.add("WebSearch");
  }
  if (policy.network?.webFetch === false) {
    disallowed.add("WebFetch");
  }
  return uniqueValues([...disallowed]);
}

export function buildAgentTemplatePermissionChips(
  template: Pick<AgentTemplate, "defaultTools" | "allowDelegation">,
): AgentTemplatePermissionChip[] {
  const values = toolPolicyToCapabilityFields(template.defaultTools, {
    allowDelegation: template.allowDelegation,
  });
  return buildCapabilityPermissionChips(values);
}

function buildAdvancedToolOptions(
  templates: readonly AgentTemplate[],
  advancedDisallowedTools: string | undefined,
): AgentTemplateCapabilityOption[] {
  const templateTools = new Set<string>();
  for (const template of templates) {
    for (const tool of normalizeDisallowedTools(template.defaultTools)) {
      if (tool.trim() && !isGroupedCapabilityToolName(tool)) {
        templateTools.add(tool.trim());
      }
    }
  }
  const currentTools = new Set(
    parseList(advancedDisallowedTools ?? "").filter((tool) => !isGroupedCapabilityToolName(tool)),
  );
  const values = uniqueValues([...templateTools, ...currentTools]);
  return values.map((value) => {
    if (templateTools.has(value)) {
      return {
        value,
        label: value,
        sourceLabel: i18n.t("agent.option.preset"),
        description: i18n.t("agent.option.presetDescription"),
      };
    }
    return {
      value,
      label: value,
      sourceLabel: i18n.t("agent.option.current"),
      description: i18n.t("agent.option.currentToolDescription"),
    };
  });
}

function requireTemplateField(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(i18n.t("agent.validation.required", { label }));
  }
  return trimmed;
}

function slugifyTemplateId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}
