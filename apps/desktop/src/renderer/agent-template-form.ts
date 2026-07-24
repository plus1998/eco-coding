import type {
  AgentDomain,
  AgentTemplate,
  McpServerConfigView,
  ToolPolicy,
} from "../shared/ipc";
import { parseAllowedToolPatterns, sanitizeMcpServerName } from "../shared/mcp";
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

export const AGENT_DOMAIN_OPTIONS: Array<{ value: AgentDomain; label: string }> = [
  { value: "coding", label: "Coding" },
  { value: "research", label: "Research" },
  { value: "writing", label: "Writing" },
  { value: "product", label: "Product" },
  { value: "data", label: "Data" },
  { value: "ops", label: "Ops" },
  { value: "custom", label: "Custom" },
];

export interface AgentTemplateFormState extends ToolCapabilityFieldValues {
  id: string;
  name: string;
  description: string;
  domain: AgentDomain;
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
  mcpServers: AgentTemplateCapabilityOption[];
  mcpTools: AgentTemplateCapabilityOption[];
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
    domain: "custom",
    prompt: "",
    whenToUse: "",
    outputContract: "",
    ...createDefaultToolCapabilityFields(),
  };
}

export function agentTemplateToForm(template: AgentTemplate): AgentTemplateFormState {
  const capability = toolPolicyToCapabilityFields(template.defaultTools, {
    allowDelegation: template.allowDelegation,
    mcpServers: template.mcpServers,
  });
  return {
    id: template.id,
    name: template.name,
    description: template.description,
    domain: template.domain,
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
  const baseId = `user.${template.domain}.${slugifyTemplateId(template.name) || "agent"}`;
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
  const mcpServers = parseList(form.mcpServers);
  const defaultTools = capabilityFieldsToToolPolicy(form);
  return {
    id,
    name,
    description,
    domain: form.domain,
    prompt,
    whenToUse,
    ...(form.outputContract.trim() ? { outputContract: form.outputContract.trim() } : {}),
    defaultTools,
    mcpServers,
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

export function formatAgentDomain(domain: AgentDomain): string {
  return AGENT_DOMAIN_OPTIONS.find((option) => option.value === domain)?.label ?? domain;
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
  form?: Pick<ToolCapabilityFieldValues, "advancedDisallowedTools" | "mcpServers" | "mcpTools">;
  mcpServers?: readonly McpServerConfigView[];
}): AgentTemplateCapabilityOptions {
  const form = input.form;
  return {
    tools: buildAdvancedToolOptions(input.templates, form?.advancedDisallowedTools),
    mcpServers: buildMcpServerOptions(input.mcpServers ?? [], form),
    mcpTools: buildMcpToolOptions(input.templates, input.mcpServers ?? [], form),
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
  template: Pick<AgentTemplate, "defaultTools" | "mcpServers" | "allowDelegation">,
): AgentTemplatePermissionChip[] {
  const values = toolPolicyToCapabilityFields(template.defaultTools, {
    allowDelegation: template.allowDelegation,
    mcpServers: template.mcpServers,
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

function buildMcpServerOptions(
  servers: readonly McpServerConfigView[],
  form: Pick<ToolCapabilityFieldValues, "mcpServers"> | undefined,
): AgentTemplateCapabilityOption[] {
  const current = new Set(parseList(form?.mcpServers ?? ""));
  const configuredByKey = new Map<string, McpServerConfigView>();
  for (const server of servers) {
    configuredByKey.set(sanitizeMcpServerName(server.name), server);
  }
  const enabledValues = servers
    .filter((server) => server.enabled)
    .map((server) => sanitizeMcpServerName(server.name));
  const values = uniqueValues([...enabledValues, ...current]);
  return values.map((value) => {
    const server = configuredByKey.get(value);
    if (server?.enabled) {
      return {
        value,
        label: server.name,
        sourceLabel: i18n.t("agent.option.enabled"),
        description: formatMcpServerDescription(server),
      };
    }
    if (server) {
      return {
        value,
        label: server.name,
        sourceLabel: i18n.t("agent.option.disabled"),
        description: i18n.t("agent.option.disabledServerDescription"),
      };
    }
    return {
      value,
      label: value,
      sourceLabel: i18n.t("agent.option.unconfigured"),
      description: i18n.t("agent.option.unconfiguredServerDescription"),
    };
  });
}

function buildMcpToolOptions(
  templates: readonly AgentTemplate[],
  servers: readonly McpServerConfigView[],
  form: Pick<ToolCapabilityFieldValues, "mcpTools"> | undefined,
): AgentTemplateCapabilityOption[] {
  const templateTools = new Set(
    templates.flatMap((template) => template.defaultTools.mcp?.allowedTools ?? []).filter(Boolean),
  );
  const currentTools = new Set(parseList(form?.mcpTools ?? ""));
  const configuredOptions: AgentTemplateCapabilityOption[] = servers
    .filter((server) => server.enabled)
    .flatMap((server) =>
      parseAllowedToolPatterns(server.allowedTools, server.name).map((value) => ({
        value,
        label: value,
        sourceLabel: server.name,
        description: server.allowedTools.trim()
          ? i18n.t("agent.option.serverAllowlist")
          : i18n.t("agent.option.serverWildcard"),
      })),
    );
  const configuredByValue = new Map(configuredOptions.map((option) => [option.value, option]));
  const values = uniqueValues([
    ...configuredOptions.map((option) => option.value),
    ...templateTools,
    ...currentTools,
  ]);
  return values.map((value) => {
    const configured = configuredByValue.get(value);
    if (configured) {
      return configured;
    }
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
      description: i18n.t("agent.option.currentMcpToolDescription"),
    };
  });
}

function formatMcpServerDescription(server: McpServerConfigView): string {
  if (server.allowedTools.trim()) {
    return i18n.t("agent.option.allowlistDescription");
  }
  return i18n.t("agent.option.wildcardDescription");
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
