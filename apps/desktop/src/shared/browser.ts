/** Built-in Eco browser MCP server name (must stay sanitizable for MCP tool prefixes). */
export const ECO_AGENT_BROWSER_MCP_SERVER = "eco_agent_browser";

export const ECO_AGENT_BROWSER_ALLOWED_TOOL = `mcp__${ECO_AGENT_BROWSER_MCP_SERVER}__*`;

/** Claude / skill frontmatter name and disk folder under ~/.claude/skills. */
export const ECO_AGENT_BROWSER_SKILL_NAME = "eco-agent-browser";

/**
 * Short system append when browser Agent integration is ON.
 * Detailed workflow lives in the bundled skill `eco-agent-browser`.
 */
export const ECO_AGENT_BROWSER_PROMPT_APPEND = [
  "Built-in browser (Eco): one shared session for the human and the Agent.",
  "MCP tools under server `eco_agent_browser` (e.g. `mcp__eco_agent_browser__agent_browser_open`) drive the same in-app panel the user sees in the right task tray.",
  "If the user already opened a page there, continue in that session (snapshot first). Do not use macOS `open` / a separate Chrome when this integration is available.",
  `Prefer Skill \`${ECO_AGENT_BROWSER_SKILL_NAME}\` for the snapshot-and-ref workflow.`,
].join("\n");

export interface BrowserSettingsSnapshot {
  /** When true, inject agent-browser MCP + prompt into Agent runs. */
  agentIntegrationEnabled: boolean;
}

export function defaultBrowserSettings(): BrowserSettingsSnapshot {
  return {
    agentIntegrationEnabled: false,
  };
}

export function normalizeBrowserSettingsSnapshot(value: unknown): BrowserSettingsSnapshot {
  if (!value || typeof value !== "object") {
    return defaultBrowserSettings();
  }
  const record = value as Record<string, unknown>;
  return {
    agentIntegrationEnabled: record.agentIntegrationEnabled === true,
  };
}

export function isBrowserSettingsSnapshot(value: unknown): value is BrowserSettingsSnapshot {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return typeof record.agentIntegrationEnabled === "boolean";
}

export interface BrowserPanelBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BrowserViewState {
  url: string;
  title: string;
  canGoBack: boolean;
  canGoForward: boolean;
  isLoading: boolean;
  visible: boolean;
  cdpPort?: number;
  agentIntegrationEnabled: boolean;
  agentBrowserAvailable: boolean;
  agentBrowserUnavailableReason?: string;
  /**
   * When true, the guest navigated to a real page while the panel was hidden
   * (typical Agent/CDP drive). Renderer should open the browser task tab.
   * Cleared once the panel becomes visible via setVisible(true).
   */
  panelRevealRequested?: boolean;
}

export interface BrowserNavigateRequest {
  url: string;
  /** Open the dock (renderer should show panel). Main still navigates regardless. */
  reveal?: boolean;
}

export interface BrowserSetBoundsRequest {
  bounds: BrowserPanelBounds;
}

export interface BrowserSetVisibleRequest {
  visible: boolean;
}

export function isBrowserHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function normalizeBrowserNavigateUrl(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (!trimmed) {
    return undefined;
  }
  if (isBrowserHttpUrl(trimmed)) {
    return trimmed;
  }
  if (/^[\w.-]+\.[a-z]{2,}([/:?#].*)?$/i.test(trimmed) && !/\s/.test(trimmed)) {
    const withScheme = `https://${trimmed}`;
    return isBrowserHttpUrl(withScheme) ? withScheme : undefined;
  }
  return undefined;
}

export function appendBrowserPrompt(
  base: string | undefined,
  browserAppend: string | undefined,
): string | undefined {
  const parts = [base?.trim(), browserAppend?.trim()].filter(
    (part): part is string => Boolean(part),
  );
  if (parts.length === 0) {
    return undefined;
  }
  return parts.join("\n\n");
}

/**
 * Surface the human browser tab only for "open / go somewhere" CDP commands.
 * agent-browser's `agent_browser_open` drives the shared guest via Page.navigate*.
 * MCP connect, domain enable, snapshot, click, screenshot must stay silent.
 */
export function shouldRevealBrowserForCdpActivity(detail: {
  kind: "ws-connect" | "cdp-method";
  method?: string;
}): boolean {
  if (detail.kind !== "cdp-method" || !detail.method) {
    return false;
  }
  return (
    detail.method === "Page.navigate" ||
    detail.method === "Page.navigateToHistoryEntry" ||
    detail.method === "Page.reload"
  );
}

/** MCP / SDK tool names that mean agent-browser open on the shared guest. */
export function isEcoAgentBrowserOpenToolName(toolName: string): boolean {
  const name = toolName.trim().toLowerCase();
  if (!name) {
    return false;
  }
  if (name.includes("agent_browser_open")) {
    return true;
  }
  // Full Claude-style: mcp__eco_agent_browser__agent_browser_open
  if (name.includes("eco_agent_browser") && name.includes("open")) {
    return true;
  }
  // any eco_agent_browser tool may need the shared panel visible
  return name.includes("eco_agent_browser") || name.includes("mcp__eco_agent_browser");
}

/** Resolve tool display name from thread-run / SDK payloads. */
export function resolveToolNameFromActivityPayload(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") {
    return undefined;
  }
  const root = payload as Record<string, unknown>;
  if (typeof root.tool_name === "string" && root.tool_name.trim()) {
    return root.tool_name.trim();
  }
  if (typeof root.name === "string" && root.name.trim()) {
    return root.name.trim();
  }
  const tool = root.tool;
  if (tool && typeof tool === "object" && !Array.isArray(tool)) {
    const name = (tool as Record<string, unknown>).name;
    if (typeof name === "string" && name.trim()) {
      return name.trim();
    }
  }
  if (typeof root.message === "string") {
    const match = root.message.match(/Tool:\s*([^\s·]+)/i);
    if (match?.[1]) {
      return match[1].trim();
    }
  }
  return undefined;
}

/** Best-effort URL from tool.started payload (Claude SDK / Codex varies). */
export function extractUrlFromBrowserOpenToolPayload(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") {
    return undefined;
  }
  const root = payload as Record<string, unknown>;
  const bags: unknown[] = [
    root.url,
    root.href,
    root.input,
    root.tool_input,
    root.arguments,
    root.toolInput,
    root.mcpInput,
    root.tool,
    root.detail,
    root.mcpItem,
  ];
  if (typeof root.tool === "object" && root.tool && !Array.isArray(root.tool)) {
    const tool = root.tool as Record<string, unknown>;
    bags.push(tool.detail, tool.url, tool.input);
  }
  for (const candidate of bags) {
    if (typeof candidate === "string") {
      const fromString = extractUrlFromLooseText(candidate);
      if (fromString) {
        return fromString;
      }
      continue;
    }
    if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
      const rec = candidate as Record<string, unknown>;
      for (const key of ["url", "href", "uri", "target"] as const) {
        if (typeof rec[key] === "string") {
          const normalized = normalizeBrowserNavigateUrl(String(rec[key]));
          if (normalized) {
            return normalized;
          }
        }
      }
      if (typeof rec.command === "string") {
        const fromCmd = extractUrlFromLooseText(rec.command);
        if (fromCmd) {
          return fromCmd;
        }
      }
      if (typeof rec.detail === "string") {
        const fromDetail = extractUrlFromLooseText(rec.detail);
        if (fromDetail) {
          return fromDetail;
        }
      }
    }
  }
  // Last resort: scan short string leaves on root for http(s)
  for (const value of Object.values(root)) {
    if (typeof value === "string" && value.length < 500) {
      const found = extractUrlFromLooseText(value);
      if (found) {
        return found;
      }
    }
  }
  return undefined;
}

function extractUrlFromLooseText(text: string): string | undefined {
  const trimmed = text.trim();
  if (!trimmed) {
    return undefined;
  }
  const direct = normalizeBrowserNavigateUrl(trimmed);
  if (direct) {
    return direct;
  }
  const match = trimmed.match(/https?:\/\/[^\s"'<>]+/i);
  if (match?.[0]) {
    return normalizeBrowserNavigateUrl(match[0]);
  }
  return undefined;
}
