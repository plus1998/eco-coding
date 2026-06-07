import type { AgentDomain, AgentTemplate, ProviderConfigView, ToolPolicy } from "../shared/ipc";

export const AGENT_DOMAIN_OPTIONS: Array<{ value: AgentDomain; label: string }> = [
  { value: "coding", label: "Coding" },
  { value: "research", label: "Research" },
  { value: "writing", label: "Writing" },
  { value: "product", label: "Product" },
  { value: "data", label: "Data" },
  { value: "ops", label: "Ops" },
  { value: "custom", label: "Custom" },
];

export const AGENT_SOURCE_OPTIONS = [
  { value: "user", label: "用户" },
  { value: "project", label: "项目" },
] as const;

export type EditableAgentSource = (typeof AGENT_SOURCE_OPTIONS)[number]["value"];

export interface AgentTemplateFormState {
  id: string;
  name: string;
  description: string;
  domain: AgentDomain;
  prompt: string;
  whenToUse: string;
  outputContract: string;
  allowedTools: string;
  disallowedTools: string;
  providerId: string;
  modelId: string;
  mcpServers: string;
  mcpTools: string;
  skills: string;
  allowDelegation: boolean;
  source: EditableAgentSource;
}

export type AgentTemplatePermissionTone = "allow" | "deny" | "warn" | "neutral";

export interface AgentTemplatePermissionChip {
  label: string;
  tone: AgentTemplatePermissionTone;
}

export function createBlankAgentTemplateForm(
  providers: readonly ProviderConfigView[],
  existingTemplates: readonly AgentTemplate[] = [],
): AgentTemplateFormState {
  const defaultProvider = providers[0];
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
    allowedTools: "Read, WebSearch, WebFetch",
    disallowedTools: "Bash, Write, Edit",
    providerId: defaultProvider?.id ?? "",
    modelId: defaultProvider?.defaultModel ?? "",
    mcpServers: "",
    mcpTools: "",
    skills: "",
    allowDelegation: false,
    source: "user",
  };
}

export function agentTemplateToForm(
  template: AgentTemplate,
  providers: readonly ProviderConfigView[],
): AgentTemplateFormState {
  const providerId = template.defaultModelRef?.providerId ?? providers[0]?.id ?? "";
  const provider = providers.find((entry) => entry.id === providerId);
  return {
    id: template.id,
    name: template.name,
    description: template.description,
    domain: template.domain,
    prompt: template.prompt,
    whenToUse: template.whenToUse,
    outputContract: template.outputContract ?? "",
    allowedTools: formatList(template.defaultTools.allowed),
    disallowedTools: formatList(template.defaultTools.disallowed),
    providerId,
    modelId: template.defaultModelRef?.modelId ?? provider?.defaultModel ?? "",
    mcpServers: formatList(template.mcpServers),
    mcpTools: formatList(template.defaultTools.mcp?.allowedTools ?? []),
    skills: formatList(template.skills),
    allowDelegation: template.allowDelegation,
    source: template.source === "project" ? "project" : "user",
  };
}

export function createCopiedAgentTemplateForm(
  template: AgentTemplate,
  existingTemplates: readonly AgentTemplate[],
  providers: readonly ProviderConfigView[],
): AgentTemplateFormState {
  const form = agentTemplateToForm(template, providers);
  const baseId = `user.${template.domain}.${slugifyTemplateId(template.name) || "agent"}`;
  return {
    ...form,
    id: createUniqueTemplateId(
      baseId,
      existingTemplates.map((entry) => entry.id),
    ),
    name: `${template.name} Copy`,
    source: "user",
  };
}

export function buildAgentTemplateFromForm(
  form: AgentTemplateFormState,
  options: { existing?: AgentTemplate | undefined; nowIso?: string | undefined } = {},
): AgentTemplate {
  const id = requireTemplateField(form.id, "子代理模板 id");
  if (id.startsWith("builtin.")) {
    throw new Error("内置子代理模板 id 不可用于用户配置。");
  }
  if (!/^[a-zA-Z0-9_.-]+$/.test(id)) {
    throw new Error("子代理模板 id 只能包含字母、数字、点、下划线和连字符。");
  }
  const name = requireTemplateField(form.name, "名称");
  const description = requireTemplateField(form.description, "描述");
  const whenToUse = requireTemplateField(form.whenToUse, "使用时机");
  const prompt = requireTemplateField(form.prompt, "提示词");
  const providerId = requireTemplateField(form.providerId, "默认模型 Provider");
  const modelId = requireTemplateField(form.modelId, "默认模型");
  const mcpServers = parseList(form.mcpServers);
  const defaultTools = buildToolPolicyFromForm(form);
  return {
    id,
    name,
    description,
    domain: form.domain,
    prompt,
    whenToUse,
    ...(form.outputContract.trim() ? { outputContract: form.outputContract.trim() } : {}),
    defaultTools,
    defaultModelRef: { providerId, modelId },
    mcpServers,
    skills: parseList(form.skills),
    allowDelegation: form.allowDelegation,
    builtIn: false,
    source: form.source,
    version: (options.existing?.version ?? 0) + 1,
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
    return "内置";
  }
  if (template.source === "project") {
    return "项目";
  }
  if (template.source === "derived") {
    return "派生";
  }
  return "用户";
}

export function parseList(value: string): string[] {
  return value
    .split(/[\n,，]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function buildAgentTemplatePermissionChips(
  template: Pick<AgentTemplate, "defaultTools" | "mcpServers">,
): AgentTemplatePermissionChip[] {
  const tools = template.defaultTools;
  const allowed = new Set(tools.allowed);
  const disallowed = new Set(tools.disallowed);
  const bashEnabled = tools.bash?.enabled === true && allowed.has("Bash") && !disallowed.has("Bash");
  const readScope =
    tools.filesystem?.read ?? (hasAny(allowed, ["Read", "Glob", "Grep", "Bash"]) ? "workspace" : "none");
  const writeScope =
    tools.filesystem?.write ??
    (hasAny(allowed, ["Write", "Edit", "MultiEdit", "NotebookEdit"]) ? "workspace" : "none");
  const webSearch = tools.network?.webSearch ?? (allowed.has("WebSearch") && !disallowed.has("WebSearch"));
  const webFetch = tools.network?.webFetch ?? (allowed.has("WebFetch") && !disallowed.has("WebFetch"));
  const mcpServerCount = new Set([...(tools.mcp?.allowedServers ?? []), ...template.mcpServers]).size;
  const mcpToolCount = tools.mcp?.allowedTools.length ?? 0;
  const chips: AgentTemplatePermissionChip[] = [
    {
      label: bashEnabled ? `Bash ${formatBashApproval(tools.bash?.approval)}` : "Bash 禁用",
      tone: bashEnabled ? (tools.bash?.approval === "never" ? "warn" : "allow") : "deny",
    },
    {
      label: `读 ${formatReadScope(readScope)}`,
      tone: readScope === "none" ? "deny" : "allow",
    },
    {
      label: `写 ${formatWriteScope(writeScope)}`,
      tone: writeScope === "none" ? "deny" : "allow",
    },
    {
      label:
        webSearch || webFetch
          ? `网络 ${[webSearch ? "Search" : "", webFetch ? "Fetch" : ""].filter(Boolean).join("/")}`
          : "网络关闭",
      tone: webSearch || webFetch ? "allow" : "deny",
    },
    {
      label:
        mcpServerCount > 0 || mcpToolCount > 0
          ? `MCP ${mcpServerCount} 个服务${mcpToolCount > 0 ? `/${mcpToolCount} 个工具` : ""}`
          : "MCP 关闭",
      tone: mcpServerCount > 0 || mcpToolCount > 0 ? "allow" : "neutral",
    },
  ];

  if (tools.bash?.commandAllowlist?.length) {
    chips.push({ label: `命令白名单 ${tools.bash.commandAllowlist.length}`, tone: "allow" });
  }
  if (tools.bash?.commandDenylist?.length) {
    chips.push({ label: `命令黑名单 ${tools.bash.commandDenylist.length}`, tone: "deny" });
  }
  if (tools.disallowed.length > 0) {
    chips.push({ label: `禁用 ${formatShortList(tools.disallowed)}`, tone: "deny" });
  }
  return chips;
}

function buildToolPolicyFromForm(form: AgentTemplateFormState): ToolPolicy {
  const allowed = parseList(form.allowedTools);
  const disallowed = parseList(form.disallowedTools);
  const mcpServers = parseList(form.mcpServers);
  const mcpTools = parseList(form.mcpTools);
  const bashEnabled = allowed.includes("Bash") && !disallowed.includes("Bash");
  const writeEnabled = ["Write", "Edit", "MultiEdit"].some(
    (tool) => allowed.includes(tool) && !disallowed.includes(tool),
  );
  const readEnabled = ["Read", "Glob", "Grep", "Bash"].some(
    (tool) => allowed.includes(tool) && !disallowed.includes(tool),
  );
  const webSearch = allowed.includes("WebSearch") && !disallowed.includes("WebSearch");
  const webFetch = allowed.includes("WebFetch") && !disallowed.includes("WebFetch");
  return {
    allowed,
    disallowed,
    ...(bashEnabled ? { bash: { enabled: true, approval: "risky" as const } } : {}),
    ...(mcpServers.length > 0 || mcpTools.length > 0
      ? { mcp: { allowedServers: mcpServers, allowedTools: mcpTools } }
      : {}),
    filesystem: {
      read: readEnabled ? "workspace" : "none",
      write: writeEnabled ? "workspace" : "none",
    },
    network: { webSearch, webFetch },
  };
}

function hasAny(values: ReadonlySet<string>, candidates: readonly string[]): boolean {
  return candidates.some((candidate) => values.has(candidate));
}

function formatBashApproval(value: NonNullable<ToolPolicy["bash"]>["approval"] | undefined): string {
  if (value === "always") {
    return "每次确认";
  }
  if (value === "never") {
    return "免确认";
  }
  return "风险确认";
}

function formatReadScope(value: NonNullable<ToolPolicy["filesystem"]>["read"]): string {
  if (value === "none") {
    return "禁用";
  }
  if (value === "extra_dirs") {
    return "工作区+扩展";
  }
  return "工作区";
}

function formatWriteScope(value: NonNullable<ToolPolicy["filesystem"]>["write"]): string {
  return value === "workspace" ? "工作区" : "禁用";
}

function formatShortList(values: readonly string[]): string {
  const visible = values.slice(0, 3).join("/");
  return values.length > 3 ? `${visible}+${values.length - 3}` : visible;
}

function formatList(values: readonly string[]): string {
  return values.join(", ");
}

function requireTemplateField(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${label}不能为空。`);
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
