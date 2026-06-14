import type {
  AgentDomain,
  AgentTemplate,
  McpServerConfigView,
  ToolPolicy,
} from "../shared/ipc";
import { resolveEffectiveBashPolicy } from "@eco/runtime";
import { parseAllowedToolPatterns, sanitizeMcpServerName } from "../shared/mcp";

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
  disallowedTools: string;
  mcpServers: string;
  mcpTools: string;
  bashEnabled: boolean;
  bashCommandAllowlist: string;
  bashCommandDenylist: string;
  filesystemRead: NonNullable<ToolPolicy["filesystem"]>["read"];
  filesystemWrite: NonNullable<ToolPolicy["filesystem"]>["write"];
  networkWebSearch: boolean;
  networkWebFetch: boolean;
  allowDelegation: boolean;
  source: EditableAgentSource;
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
    disallowedTools: "Bash, Write, Edit, MultiEdit, NotebookEdit",
    mcpServers: "",
    mcpTools: "",
    bashEnabled: false,
    bashCommandAllowlist: "",
    bashCommandDenylist: "",
    filesystemRead: "workspace",
    filesystemWrite: "none",
    networkWebSearch: true,
    networkWebFetch: true,
    allowDelegation: false,
    source: "user",
  };
}

export function agentTemplateToForm(template: AgentTemplate): AgentTemplateFormState {
  return {
    id: template.id,
    name: template.name,
    description: template.description,
    domain: template.domain,
    prompt: template.prompt,
    whenToUse: template.whenToUse,
    outputContract: template.outputContract ?? "",
    ...toolPolicyToFormFields(template.defaultTools),
    mcpServers: formatList(template.mcpServers),
    allowDelegation: template.allowDelegation,
    source: template.source === "project" ? "project" : "user",
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
    mcpServers,
    skills: [],
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

export function toggleAgentTemplateDisallowedTool(
  form: Pick<AgentTemplateFormState, "disallowedTools">,
  value: string,
  checked: boolean,
): Pick<AgentTemplateFormState, "disallowedTools"> {
  const tool = value.trim();
  if (!tool) {
    return { disallowedTools: formatList(parseList(form.disallowedTools)) };
  }
  const disallowed = parseList(form.disallowedTools).filter((entry) => entry !== tool);
  if (checked) {
    disallowed.push(tool);
  }
  return { disallowedTools: formatList(uniqueValues(disallowed)) };
}

export function buildAgentTemplateCapabilityOptions(input: {
  templates: readonly AgentTemplate[];
  form?: Pick<AgentTemplateFormState, "disallowedTools" | "mcpServers" | "mcpTools">;
  mcpServers?: readonly McpServerConfigView[];
}): AgentTemplateCapabilityOptions {
  const form = input.form;
  return {
    tools: buildToolOptions(input.templates, form),
    mcpServers: buildMcpServerOptions(input.mcpServers ?? [], form),
    mcpTools: buildMcpToolOptions(input.templates, input.mcpServers ?? [], form),
  };
}

export function buildAgentTemplatePermissionChips(
  template: Pick<AgentTemplate, "defaultTools" | "mcpServers">,
): AgentTemplatePermissionChip[] {
  const tools = template.defaultTools;
  const disallowed = new Set(tools.disallowed);
  const bashEnabled = resolveEffectiveBashPolicy(tools).enabled;
  const readScope = tools.filesystem?.read ?? "workspace";
  const writeScope = tools.filesystem?.write ?? "none";
  const webSearch = tools.network?.webSearch ?? false;
  const webFetch = tools.network?.webFetch ?? false;
  const mcpServerCount = new Set([...(tools.mcp?.allowedServers ?? []), ...template.mcpServers]).size;
  const mcpToolCount = tools.mcp?.allowedTools.length ?? 0;
  const chips: AgentTemplatePermissionChip[] = [
    {
      label: bashEnabled ? "Bash" : "Bash 禁用",
      tone: bashEnabled ? "allow" : "deny",
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

const COMMON_CLAUDE_TOOL_OPTIONS: AgentTemplateCapabilityOption[] = [
  {
    value: "Agent",
    label: "Agent",
    description: "调用 Eco 子代理。",
    sourceLabel: "Claude",
  },
  {
    value: "Task",
    label: "Task",
    description: "旧式子任务委派工具。",
    sourceLabel: "Claude",
  },
  {
    value: "TaskList",
    label: "TaskList",
    description: "列出委派任务状态。",
    sourceLabel: "Claude",
  },
  {
    value: "TaskOutput",
    label: "TaskOutput",
    description: "读取委派任务输出。",
    sourceLabel: "Claude",
  },
  {
    value: "Skill",
    label: "Skill",
    description: "加载已配置的 Claude Skill。",
    sourceLabel: "Claude",
  },
  {
    value: "TaskCreate",
    label: "TaskCreate",
    description: "创建用户可见的执行进度任务。",
    sourceLabel: "Claude",
  },
  {
    value: "TaskUpdate",
    label: "TaskUpdate",
    description: "更新用户可见的执行进度任务状态。",
    sourceLabel: "Claude",
  },
  { value: "Read", label: "Read", description: "读取文件。", sourceLabel: "Claude" },
  { value: "Glob", label: "Glob", description: "按模式查找文件。", sourceLabel: "Claude" },
  { value: "Grep", label: "Grep", description: "搜索文本。", sourceLabel: "Claude" },
  { value: "LS", label: "LS", description: "列出目录。", sourceLabel: "Claude" },
  { value: "Bash", label: "Bash", description: "运行命令。", sourceLabel: "Claude" },
  { value: "Write", label: "Write", description: "写入新文件。", sourceLabel: "Claude" },
  { value: "Edit", label: "Edit", description: "编辑文件。", sourceLabel: "Claude" },
  { value: "MultiEdit", label: "MultiEdit", description: "批量编辑文件。", sourceLabel: "Claude" },
  {
    value: "NotebookRead",
    label: "NotebookRead",
    description: "读取 notebook。",
    sourceLabel: "Claude",
  },
  {
    value: "NotebookEdit",
    label: "NotebookEdit",
    description: "编辑 notebook。",
    sourceLabel: "Claude",
  },
  { value: "WebSearch", label: "WebSearch", description: "网页搜索。", sourceLabel: "Claude" },
  { value: "WebFetch", label: "WebFetch", description: "抓取网页。", sourceLabel: "Claude" },
  { value: "TodoWrite", label: "TodoWrite", description: "维护任务列表。", sourceLabel: "Claude" },
  {
    value: "AskUserQuestion",
    label: "AskUserQuestion",
    description: "请求用户选择或补充信息。",
    sourceLabel: "Eco",
  },

];

function buildToolOptions(
  templates: readonly AgentTemplate[],
  form: Pick<AgentTemplateFormState, "disallowedTools"> | undefined,
): AgentTemplateCapabilityOption[] {
  const common = new Map(COMMON_CLAUDE_TOOL_OPTIONS.map((option) => [option.value, option]));
  const templateTools = new Set<string>();
  for (const template of templates) {
    for (const tool of template.defaultTools.disallowed) {
      if (tool.trim()) {
        templateTools.add(tool.trim());
      }
    }
  }
  const currentTools = new Set(parseList(form?.disallowedTools ?? ""));
  const values = uniqueValues([
    ...COMMON_CLAUDE_TOOL_OPTIONS.map((option) => option.value),
    ...templateTools,
    ...currentTools,
  ]);
  return values.map((value) => {
    const commonOption = common.get(value);
    if (commonOption) {
      return commonOption;
    }
    if (templateTools.has(value)) {
      return {
        value,
        label: value,
        sourceLabel: "预设",
        description: "来自内置或现有子代理模板。",
      };
    }
    return {
      value,
      label: value,
      sourceLabel: "当前",
      description: "当前配置中的自定义工具名。",
    };
  });
}

function buildMcpServerOptions(
  servers: readonly McpServerConfigView[],
  form: Pick<AgentTemplateFormState, "mcpServers"> | undefined,
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
        sourceLabel: "已启用",
        description: formatMcpServerDescription(server),
      };
    }
    if (server) {
      return {
        value,
        label: server.name,
        sourceLabel: "未启用",
        description: "当前配置中保留的 MCP 服务器，但该服务器未启用。",
      };
    }
    return {
      value,
      label: value,
      sourceLabel: "未配置",
      description: "当前模板保留的 MCP 服务器名，未在全局 MCP 设置中找到。",
    };
  });
}

function buildMcpToolOptions(
  templates: readonly AgentTemplate[],
  servers: readonly McpServerConfigView[],
  form: Pick<AgentTemplateFormState, "mcpTools"> | undefined,
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
          ? "来自该 MCP 服务器的工具 allowlist。"
          : "该 MCP 服务器未声明具体工具，按服务器级 wildcard 授权。",
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
        sourceLabel: "预设",
        description: "来自内置或现有子代理模板。",
      };
    }
    return {
      value,
      label: value,
      sourceLabel: "当前",
      description: "当前模板保留的 MCP 工具模式，未在已启用 MCP 服务器 allowlist 中找到。",
    };
  });
}

function formatMcpServerDescription(server: McpServerConfigView): string {
  if (server.allowedTools.trim()) {
    return "使用该服务器配置中声明的工具 allowlist。";
  }
  return "该服务器未声明具体工具，运行时只能按服务器级 wildcard 授权。";
}

function buildToolPolicyFromForm(form: AgentTemplateFormState): ToolPolicy {
  const disallowed = parseList(form.disallowedTools);
  const mcpServers = parseList(form.mcpServers);
  const mcpTools = parseList(form.mcpTools);
  return {
    allowed: [],
    disallowed,
    bash: {
      enabled: form.bashEnabled && !disallowed.includes("Bash"),
      ...(form.bashEnabled &&
      !disallowed.includes("Bash") &&
      parseList(form.bashCommandAllowlist).length > 0
        ? { commandAllowlist: parseList(form.bashCommandAllowlist) }
        : {}),
      ...(form.bashEnabled &&
      !disallowed.includes("Bash") &&
      parseList(form.bashCommandDenylist).length > 0
        ? { commandDenylist: parseList(form.bashCommandDenylist) }
        : {}),
    },
    ...(mcpServers.length > 0 || mcpTools.length > 0
      ? { mcp: { allowedServers: mcpServers, allowedTools: mcpTools } }
      : {}),
    filesystem: {
      read: form.filesystemRead,
      write: form.filesystemWrite,
    },
    network: {
      webSearch: form.networkWebSearch,
      webFetch: form.networkWebFetch,
    },
  };
}

function toolPolicyToFormFields(policy: ToolPolicy): Pick<
  AgentTemplateFormState,
  | "disallowedTools"
  | "mcpTools"
  | "bashEnabled"
  | "bashCommandAllowlist"
  | "bashCommandDenylist"
  | "filesystemRead"
  | "filesystemWrite"
  | "networkWebSearch"
  | "networkWebFetch"
> {
  const disallowed = new Set(policy.disallowed);
  return {
    disallowedTools: formatList(policy.disallowed),
    mcpTools: formatList(policy.mcp?.allowedTools ?? []),
    bashEnabled: resolveEffectiveBashPolicy(policy).enabled,
    bashCommandAllowlist: formatList(policy.bash?.commandAllowlist ?? []),
    bashCommandDenylist: formatList(policy.bash?.commandDenylist ?? []),
    filesystemRead: policy.filesystem?.read ?? "workspace",
    filesystemWrite: policy.filesystem?.write ?? "none",
    networkWebSearch: policy.network?.webSearch ?? false,
    networkWebFetch: policy.network?.webFetch ?? false,
  };
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

function uniqueValues(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}
