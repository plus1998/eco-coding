import type { ToolPolicy } from "../shared/ipc";
import { materializeEcoToolPolicy } from "@eco/runtime/tool-permission-policy";
import { parseList, uniqueValues } from "./agent-template-form-utils";
import { i18n } from "./i18n";

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
  network: boolean;
  skill: boolean;
  askUser: boolean;
  taskProgress: boolean;
  allowDelegation: boolean;
  advancedDisallowedTools: string;
  codexSandboxOverride: "" | "read-only";
}

export interface ToolCapabilityPreset {
  id: string;
  label: string;
  hint: string;
  values: Omit<
    ToolCapabilityFieldValues,
    "advancedDisallowedTools" | "codexSandboxOverride" | "allowDelegation"
  >;
}

export type CoreCapabilitySupport = "native" | "adapted" | "unsupported";

export interface CoreCapabilityDiagnostic {
  core: "claude" | "codex";
  support: CoreCapabilitySupport;
  messages: string[];
}

export function diagnoseCoreCapabilities(
  values: ToolCapabilityFieldValues,
): CoreCapabilityDiagnostic[] {
  const claudeMessages: string[] = [];
  const codexMessages: string[] = [];
  let codexSupport: CoreCapabilitySupport = "native";

  if (values.writeCodebase && !values.bash) {
    codexSupport = "unsupported";
    codexMessages.push(i18n.t("agent.capability.codexWriteNeedsShell"));
  } else {
    if (values.readCodebase && values.readScope === "extra_dirs") {
      if (codexSupport === "native") codexSupport = "adapted";
      codexMessages.push(i18n.t("agent.capability.codexExtraDirs"));
    }
    if (values.taskProgress) {
      if (codexSupport === "native") codexSupport = "adapted";
      codexMessages.push(i18n.t("agent.capability.codexProgress"));
    }
  }

  if (parseList(values.advancedDisallowedTools).length > 0) {
    claudeMessages.push(i18n.t("agent.capability.claudeDisabled"));
  }
  return [
    { core: "claude", support: "native", messages: claudeMessages },
    { core: "codex", support: codexSupport, messages: codexMessages },
  ];
}

export const TOOL_CAPABILITY_PRESETS: ToolCapabilityPreset[] = [
  {
    id: "readonly",
    get label() {
      return i18n.t("agent.preset.readonly");
    },
    get hint() {
      return i18n.t("agent.preset.readonlyHint");
    },
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
    get label() {
      return i18n.t("agent.preset.research");
    },
    get hint() {
      return i18n.t("agent.preset.researchHint");
    },
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
    get label() {
      return i18n.t("agent.preset.coding");
    },
    get hint() {
      return i18n.t("agent.preset.codingHint");
    },
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
    get label() {
      return i18n.t("agent.preset.review");
    },
    get hint() {
      return i18n.t("agent.preset.reviewHint");
    },
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
  } = {},
): ToolCapabilityFieldValues {
  const materialized = materializeEcoToolPolicy(policy);
  const disallowed = new Set(normalizeDisallowedTools(materialized));
  const readScope = materialized.filesystem?.read ?? "workspace";
  const readCodebase = readScope !== "none";
  const writeCodebase = !FILESYSTEM_WRITE_TOOL_NAMES.every((tool) => disallowed.has(tool));
  const bash = !disallowed.has("Bash");
  const webSearchAllowed =
    materialized.network?.webSearch !== false && !disallowed.has("WebSearch");
  const webFetchAllowed = materialized.network?.webFetch !== false && !disallowed.has("WebFetch");
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
    network,
    skill,
    askUser,
    taskProgress,
    allowDelegation,
    advancedDisallowedTools: formatList(
      uniqueValues([
        ...[...disallowed].filter((tool) => !isGroupedCapabilityToolName(tool)),
        ...(policy.coreOverrides?.claude?.disallowedTools ?? []),
      ]),
    ),
    codexSandboxOverride: policy.coreOverrides?.codex?.sandboxMode ?? "",
  };
}

export function capabilityFieldsToToolPolicy(values: ToolCapabilityFieldValues): ToolPolicy {
  if (values.writeCodebase && !values.bash) {
    throw new Error(i18n.t("agent.capability.invalidWriteWithoutShell"));
  }
  const disallowed = new Set<string>();

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

  return {
    allowed: [],
    disallowed: disallowedList,
    bash: { enabled: bashAllowed },
    filesystem: {
      read: values.readCodebase ? values.readScope : "none",
      write: values.writeCodebase ? "workspace" : "none",
    },
    network: {
      webSearch: values.network,
      webFetch: values.network,
    },
    skills: { enabled: values.skill },
    interaction: { askUser: values.askUser },
    taskProgress: { enabled: values.taskProgress },
    delegation: { enabled: values.allowDelegation },
    ...((parseList(values.advancedDisallowedTools).length > 0 || values.codexSandboxOverride)
      ? {
          coreOverrides: {
            ...(parseList(values.advancedDisallowedTools).length > 0
              ? { claude: { disallowedTools: parseList(values.advancedDisallowedTools) } }
              : {}),
            ...(values.codexSandboxOverride
              ? {
                  codex: {
                    sandboxMode: values.codexSandboxOverride,
                  },
                }
              : {}),
          },
        }
      : {}),
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
    network: true,
    skill: true,
    askUser: false,
    taskProgress: false,
    allowDelegation: false,
    advancedDisallowedTools: "",
    codexSandboxOverride: "",
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
  const chips: Array<{ label: string; tone: "allow" | "deny" | "neutral" }> = [
    {
      label: values.readCodebase
        ? i18n.t("agent.chip.read", {
            scope:
              values.readScope === "extra_dirs"
                ? i18n.t("capability.workspaceExtra")
                : i18n.t("capability.workspace"),
          })
        : i18n.t("agent.chip.readDisabled"),
      tone: values.readCodebase ? "allow" : "deny",
    },
    {
      label: values.writeCodebase
        ? i18n.t("agent.chip.write")
        : i18n.t("agent.chip.writeDisabled"),
      tone: values.writeCodebase ? "allow" : "deny",
    },
    {
      label: values.bash ? "Bash" : i18n.t("agent.chip.bashDisabled"),
      tone: values.bash ? "allow" : "deny",
    },
    {
      label: values.network
        ? i18n.t("agent.chip.network")
        : i18n.t("agent.chip.networkDisabled"),
      tone: values.network ? "allow" : "deny",
    },
    {
      label: values.taskProgress
        ? i18n.t("agent.chip.progress")
        : i18n.t("agent.chip.progressDisabled"),
      tone: values.taskProgress ? "allow" : "deny",
    },
    {
      label: values.allowDelegation
        ? i18n.t("agent.chip.delegation")
        : i18n.t("agent.chip.delegationDisabled"),
      tone: values.allowDelegation ? "allow" : "deny",
    },
  ];

  if (values.skill) {
    chips.push({ label: "Skill", tone: "allow" });
  }
  if (values.askUser) {
    chips.push({ label: i18n.t("agent.chip.askUser"), tone: "allow" });
  }
  const advanced = parseList(values.advancedDisallowedTools);
  if (advanced.length > 0) {
    const visible = advanced.slice(0, 3).join("/");
    const label = i18n.t("agent.chip.advancedDisabled", {
      tools: advanced.length > 3 ? `${visible}+${advanced.length - 3}` : visible,
    });
    chips.push({ label, tone: "deny" });
  }
  return chips;
}

function formatList(values: readonly string[]): string {
  return values.join(", ");
}
