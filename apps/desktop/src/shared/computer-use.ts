/** Built-in Eco Computer Use MCP server name (must stay sanitizable for MCP tool prefixes). */
export const ECO_COMPUTER_USE_MCP_SERVER = "eco_computer_use";

export const ECO_COMPUTER_USE_ALLOWED_TOOL = `mcp__${ECO_COMPUTER_USE_MCP_SERVER}__*`;

/** Upstream open-computer-use MCP tools (9). */
export const ECO_COMPUTER_USE_TOOLS = [
  "list_apps",
  "get_app_state",
  "click",
  "perform_secondary_action",
  "scroll",
  "drag",
  "type_text",
  "press_key",
  "set_value",
] as const;

export type EcoComputerUseToolName = (typeof ECO_COMPUTER_USE_TOOLS)[number];

/** Read-only / observation tools — never require action approval. */
export const ECO_COMPUTER_USE_READ_TOOLS = ["list_apps", "get_app_state"] as const;

/** Mutating desktop actions — gated by actionApprovalMode. */
export const ECO_COMPUTER_USE_ACTION_TOOLS = [
  "click",
  "perform_secondary_action",
  "scroll",
  "drag",
  "type_text",
  "press_key",
  "set_value",
] as const;

/** Whether Agent may run mutating Computer Use tools without a human confirmation. */
export type ComputerUseActionApprovalMode = "always_allow" | "always_ask";

export const COMPUTER_USE_ACTION_APPROVAL_MODES = ["always_allow", "always_ask"] as const;

export function isComputerUseActionApprovalMode(
  value: unknown,
): value is ComputerUseActionApprovalMode {
  return (
    typeof value === "string" &&
    (COMPUTER_USE_ACTION_APPROVAL_MODES as readonly string[]).includes(value)
  );
}

export interface ComputerUseSettingsSnapshot {
  /**
   * When true, `eco_computer_use` may appear in Composer integrations.
   * Does not inject into sessions; each thread enables via integrationsEnabled.computerUse.
   */
  agentIntegrationEnabled: boolean;
  /**
   * When Agent calls mutating tools (click / type_text / …).
   * always_allow auto-approves; always_ask shows the same approval card as tools.
   */
  actionApprovalMode: ComputerUseActionApprovalMode;
}

export function defaultComputerUseSettings(): ComputerUseSettingsSnapshot {
  return {
    agentIntegrationEnabled: false,
    actionApprovalMode: "always_ask",
  };
}

export function normalizeComputerUseSettingsSnapshot(value: unknown): ComputerUseSettingsSnapshot {
  if (!value || typeof value !== "object") {
    return defaultComputerUseSettings();
  }
  const record = value as Record<string, unknown>;
  return {
    agentIntegrationEnabled: record.agentIntegrationEnabled === true,
    actionApprovalMode: isComputerUseActionApprovalMode(record.actionApprovalMode)
      ? record.actionApprovalMode
      : "always_ask",
  };
}

export function isComputerUseSettingsSnapshot(value: unknown): value is ComputerUseSettingsSnapshot {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.agentIntegrationEnabled !== "boolean") {
    return false;
  }
  if (
    record.actionApprovalMode !== undefined &&
    !isComputerUseActionApprovalMode(record.actionApprovalMode)
  ) {
    return false;
  }
  return true;
}

export function shouldAutoApproveEcoComputerUseTools(mode: ComputerUseActionApprovalMode): boolean {
  return mode === "always_allow";
}

export function isEcoComputerUseRuntimeServerName(name: string): boolean {
  const n = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-");
  return n === ECO_COMPUTER_USE_MCP_SERVER;
}

function stripToolLeafName(toolName: string): string {
  const name = toolName.trim().toLowerCase();
  if (!name) {
    return "";
  }
  const parts = name.split("__");
  return (parts[parts.length - 1] ?? name).trim();
}

/**
 * Mutating Computer Use tools gated by actionApprovalMode.
 * list_apps / get_app_state are observation-only and never require approval.
 */
export function requiresComputerUseActionApproval(toolName: string): boolean {
  const name = toolName.trim().toLowerCase();
  if (!name || !name.includes(ECO_COMPUTER_USE_MCP_SERVER)) {
    return false;
  }
  const leaf = stripToolLeafName(name);
  return (ECO_COMPUTER_USE_ACTION_TOOLS as readonly string[]).includes(leaf);
}

/**
 * Short system append when this thread enabled eco_computer_use MCP.
 * Desktop automation is OS-global — not isolated per conversation.
 */
export function buildEcoComputerUsePromptAppend(): string {
  return [
    "Built-in Computer Use (Eco): MCP server `eco_computer_use` controls the local desktop via accessibility APIs (open-computer-use).",
    "Desktop state is shared across conversations — concurrent sessions share the same OS UI.",
    "Workflow: call list_apps, then get_app_state before element-targeted actions; re-snapshot after navigation or failed actions.",
    "Prefer element_index from get_app_state; use x/y coordinates only when no AX element matches.",
    "When `mcp__eco_computer_use__*` tools are available, ALWAYS use them.",
    "Do NOT shell `open-computer-use` / `ocu` CLI (`Bash`).",
    "Do NOT use a separate Computer Use MCP server when this integration is available for the thread.",
  ].join("\n");
}

export const ECO_COMPUTER_USE_PROMPT_APPEND = buildEcoComputerUsePromptAppend();
