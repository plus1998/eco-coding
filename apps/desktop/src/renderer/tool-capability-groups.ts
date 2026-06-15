import type { ToolPolicy } from "../shared/ipc";
import { parseList, uniqueValues } from "./agent-template-form-utils";

export const DELEGATION_TOOL_NAMES = ["Agent", "Task", "TaskList", "TaskOutput"] as const;
export const FILESYSTEM_READ_TOOL_NAMES = ["Read", "Glob", "Grep", "LS", "NotebookRead"] as const;
export const FILESYSTEM_WRITE_TOOL_NAMES = ["Write", "Edit", "MultiEdit", "NotebookEdit"] as const;
export const TASK_PROGRESS_TOOL_NAMES = ["TaskCreate", "TaskUpdate", "TodoWrite"] as const;
export const NETWORK_TOOL_NAMES = ["WebSearch", "WebFetch"] as const;

export const GROUPED_CAPABILITY_TOOL_NAMES = [
  ...DELEGATION_TOOL_NAMES,
  ...FILESYSTEM_READ_TOOL_NAMES,
  ...FILESYSTEM_WRITE_TOOL_NAMES,
  ...TASK_PROGRESS_TOOL_NAMES,
  ...NETWORK_TOOL_NAMES,
  "Bash",
  "Skill",
  "AskUserQuestion",
] as const;

export interface ToolCapabilityFieldValues {
  readCodebase: boolean;
  readScope: "workspace" | "extra_dirs";
  writeCodebase: boolean;
  bash: boolean;
  bashCommandAllowlist: string;
  bashCommandDenylist: string;
  network: boolean;
  skill: boolean;
  askUser: boolean;
  taskProgress: boolean;
  allowDelegation: boolean;
  advancedDisallowedTools: string;
  mcpServers: string;
  mcpTools: string;
}

export interface ToolCapabilityPreset {
  id: string;
  label: string;
  hint: string;
  values: Omit<
    ToolCapabilityFieldValues,
    "bashCommandAllowlist" | "bashCommandDenylist" | "advancedDisallowedTools" | "mcpServers" | "mcpTools" | "allowDelegation"
  >;
}

export const TOOL_CAPABILITY_PRESETS: ToolCapabilityPreset[] = [
  {
    id: "readonly",
    label: "只读探索",
    hint: "读文件和搜索代码，不写入、不运行命令。",
    values: {
      readCodebase: true,
      readScope: "workspace",
      writeCodebase: false,
      bash: false,
      network: false,
      skill: true,
      askUser: false,
      taskProgress: false,
    },
  },
  {
    id: "research",
    label: "研究检索",
    hint: "读本地上下文，也允许联网检索。",
    values: {
      readCodebase: true,
      readScope: "workspace",
      writeCodebase: false,
      bash: false,
      network: true,
      skill: true,
      askUser: false,
      taskProgress: false,
    },
  },
  {
    id: "coding",
    label: "代码执行",
    hint: "允许读写、编辑、命令和任务进度。",
    values: {
      readCodebase: true,
      readScope: "workspace",
      writeCodebase: true,
      bash: true,
      network: false,
      skill: true,
      askUser: false,
      taskProgress: true,
    },
  },
  {
    id: "review",
    label: "评审验证",
    hint: "可读文件并运行验证命令，不允许修改文件。",
    values: {
      readCodebase: true,
      readScope: "workspace",
      writeCodebase: false,
      bash: true,
      network: false,
      skill: true,
      askUser: false,
      taskProgress: true,
    },
  },
];

export function isDelegationToolName(value: string): boolean {
  const trimmed = value.trim();
  return (
    trimmed === "Agent" ||
    trimmed === "Task" ||
    trimmed === "TaskList" ||
    trimmed === "TaskOutput" ||
    trimmed.startsWith("Agent(") ||
    trimmed.startsWith("Task(")
  );
}

export function isGroupedCapabilityToolName(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }
  if (isDelegationToolName(trimmed)) {
    return true;
  }
  return (GROUPED_CAPABILITY_TOOL_NAMES as readonly string[]).includes(trimmed);
}

export function stripGroupedToolsFromDisallowed(disallowedTools: string): string {
  return formatList(parseList(disallowedTools).filter((tool) => !isGroupedCapabilityToolName(tool)));
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

export function toolPolicyToCapabilityFields(
  policy: ToolPolicy,
  options: {
    allowDelegation?: boolean;
    mcpServers?: readonly string[];
  } = {},
): ToolCapabilityFieldValues {
  const disallowed = new Set(normalizeDisallowedTools(policy));
  const readScope = policy.filesystem?.read ?? "workspace";
  const readCodebase = readScope !== "none";
  const writeCodebase = (policy.filesystem?.write ?? "none") === "workspace";
  const bash = policy.bash?.enabled !== false && !disallowed.has("Bash");
  const webSearchAllowed =
    policy.network?.webSearch !== false && !disallowed.has("WebSearch");
  const webFetchAllowed = policy.network?.webFetch !== false && !disallowed.has("WebFetch");
  const network = webSearchAllowed || webFetchAllowed;
  const skill = !disallowed.has("Skill");
  const askUser = !disallowed.has("AskUserQuestion");
  const taskProgress = !TASK_PROGRESS_TOOL_NAMES.some((tool) => disallowed.has(tool));
  const allowDelegation =
    options.allowDelegation ??
    !DELEGATION_TOOL_NAMES.some((tool) => disallowed.has(tool));

  return {
    readCodebase,
    readScope: readScope === "extra_dirs" ? "extra_dirs" : "workspace",
    writeCodebase,
    bash,
    bashCommandAllowlist: formatList(policy.bash?.commandAllowlist ?? []),
    bashCommandDenylist: formatList(policy.bash?.commandDenylist ?? []),
    network,
    skill,
    askUser,
    taskProgress,
    allowDelegation,
    advancedDisallowedTools: formatList(
      [...disallowed].filter((tool) => !isGroupedCapabilityToolName(tool)),
    ),
    mcpServers: formatList(
      options.mcpServers && options.mcpServers.length > 0
        ? options.mcpServers
        : (policy.mcp?.allowedServers ?? []),
    ),
    mcpTools: formatList(policy.mcp?.allowedTools ?? []),
  };
}

export function capabilityFieldsToToolPolicy(values: ToolCapabilityFieldValues): ToolPolicy {
  const disallowed = new Set<string>();

  for (const tool of parseList(values.advancedDisallowedTools)) {
    if (!isGroupedCapabilityToolName(tool)) {
      disallowed.add(tool);
    }
  }

  if (!values.readCodebase) {
    for (const tool of FILESYSTEM_READ_TOOL_NAMES) {
      disallowed.add(tool);
    }
  }
  if (!values.writeCodebase) {
    for (const tool of FILESYSTEM_WRITE_TOOL_NAMES) {
      disallowed.add(tool);
    }
  }
  if (!values.bash) {
    disallowed.add("Bash");
  }
  if (!values.network) {
    for (const tool of NETWORK_TOOL_NAMES) {
      disallowed.add(tool);
    }
  }
  if (!values.skill) {
    disallowed.add("Skill");
  }
  if (!values.askUser) {
    disallowed.add("AskUserQuestion");
  }
  if (!values.taskProgress) {
    for (const tool of TASK_PROGRESS_TOOL_NAMES) {
      disallowed.add(tool);
    }
  }
  if (!values.allowDelegation) {
    for (const tool of DELEGATION_TOOL_NAMES) {
      disallowed.add(tool);
    }
  }

  const disallowedList = uniqueValues([...disallowed]);
  const bashAllowed = values.bash;
  const commandAllowlist = parseList(values.bashCommandAllowlist);
  const commandDenylist = parseList(values.bashCommandDenylist);
  const mcpServers = parseList(values.mcpServers);
  const mcpTools = parseList(values.mcpTools);

  return {
    allowed: [],
    disallowed: disallowedList,
    bash: {
      enabled: bashAllowed,
      ...(bashAllowed && commandAllowlist.length > 0 ? { commandAllowlist } : {}),
      ...(bashAllowed && commandDenylist.length > 0 ? { commandDenylist } : {}),
    },
    ...(mcpServers.length > 0 || mcpTools.length > 0
      ? { mcp: { allowedServers: mcpServers, allowedTools: mcpTools } }
      : {}),
    filesystem: {
      read: values.readCodebase ? values.readScope : "none",
      write: values.writeCodebase ? "workspace" : "none",
    },
    network: {
      webSearch: values.network,
      webFetch: values.network,
    },
  };
}

export function createDefaultToolCapabilityFields(
  overrides: Partial<ToolCapabilityFieldValues> = {},
): ToolCapabilityFieldValues {
  return {
    readCodebase: true,
    readScope: "workspace",
    writeCodebase: false,
    bash: false,
    bashCommandAllowlist: "",
    bashCommandDenylist: "",
    network: true,
    skill: true,
    askUser: false,
    taskProgress: false,
    allowDelegation: false,
    advancedDisallowedTools: "",
    mcpServers: "",
    mcpTools: "",
    ...overrides,
  };
}

export function matchesToolCapabilityPreset(
  values: ToolCapabilityFieldValues,
  preset: ToolCapabilityPreset,
): boolean {
  return (
    values.readCodebase === preset.values.readCodebase &&
    values.readScope === preset.values.readScope &&
    values.writeCodebase === preset.values.writeCodebase &&
    values.bash === preset.values.bash &&
    values.network === preset.values.network &&
    values.skill === preset.values.skill &&
    values.askUser === preset.values.askUser &&
    values.taskProgress === preset.values.taskProgress
  );
}

export function buildCapabilityPermissionChips(
  values: ToolCapabilityFieldValues,
): Array<{ label: string; tone: "allow" | "deny" | "neutral" }> {
  const mcpServerCount = parseList(values.mcpServers).length;
  const mcpToolCount = parseList(values.mcpTools).length;
  const chips: Array<{ label: string; tone: "allow" | "deny" | "neutral" }> = [
    {
      label: values.readCodebase
        ? `读 ${values.readScope === "extra_dirs" ? "工作区+扩展" : "工作区"}`
        : "读 禁用",
      tone: values.readCodebase ? "allow" : "deny",
    },
    {
      label: values.writeCodebase ? "写 工作区" : "写 禁用",
      tone: values.writeCodebase ? "allow" : "deny",
    },
    {
      label: values.bash ? "Bash" : "Bash 禁用",
      tone: values.bash ? "allow" : "deny",
    },
    {
      label: values.network ? "联网" : "联网关闭",
      tone: values.network ? "allow" : "deny",
    },
    {
      label:
        mcpServerCount > 0 || mcpToolCount > 0
          ? `MCP ${mcpServerCount} 个服务${mcpToolCount > 0 ? `/${mcpToolCount} 个工具` : ""}`
          : "MCP 关闭",
      tone: mcpServerCount > 0 || mcpToolCount > 0 ? "allow" : "neutral",
    },
    {
      label: values.taskProgress ? "可更新进度" : "进度关闭",
      tone: values.taskProgress ? "allow" : "deny",
    },
    {
      label: values.allowDelegation ? "可委派" : "委派关闭",
      tone: values.allowDelegation ? "allow" : "deny",
    },
  ];

  if (values.skill) {
    chips.push({ label: "Skill", tone: "allow" });
  }
  if (values.askUser) {
    chips.push({ label: "询问用户", tone: "allow" });
  }
  if (parseList(values.bashCommandAllowlist).length > 0) {
    chips.push({ label: `命令白名单 ${parseList(values.bashCommandAllowlist).length}`, tone: "allow" });
  }
  if (parseList(values.bashCommandDenylist).length > 0) {
    chips.push({ label: `命令黑名单 ${parseList(values.bashCommandDenylist).length}`, tone: "deny" });
  }
  const advanced = parseList(values.advancedDisallowedTools);
  if (advanced.length > 0) {
    const visible = advanced.slice(0, 3).join("/");
    const label = advanced.length > 3 ? `高级禁用 ${visible}+${advanced.length - 3}` : `高级禁用 ${visible}`;
    chips.push({ label, tone: "deny" });
  }
  return chips;
}

function formatList(values: readonly string[]): string {
  return values.join(", ");
}
