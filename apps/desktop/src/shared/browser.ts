/** Built-in Eco browser MCP server name (must stay sanitizable for MCP tool prefixes). */
export const ECO_AGENT_BROWSER_MCP_SERVER = "eco_agent_browser";

export const ECO_AGENT_BROWSER_ALLOWED_TOOL = `mcp__${ECO_AGENT_BROWSER_MCP_SERVER}__*`;

/** Claude / skill frontmatter name and disk folder under ~/.claude/skills. */
export const ECO_AGENT_BROWSER_SKILL_NAME = "eco-agent-browser";

/** Scope id when the user browses without an active Eco thread (not injectable to Agent). */
export const ECO_BROWSER_PERSONAL_SCOPE_ID = "__personal__";

export const BROWSER_TASK_TAB_PREFIX = "browser:";

/**
 * Short stable agent-browser session id for one Eco thread (stdio env + CLI --session).
 * Must stay tiny: long `thr_…` keys + Application Support paths exceed macOS socket path limits
 * (~104 bytes), which made agents invent short sessions like "web"/"chat" and desync from Eco UI.
 * Pure JS so this shared module stays usable in the Vite renderer (no node:crypto).
 */
export function browserAgentSessionKey(threadId: string): string {
  const input = threadId.trim() || "personal";
  // FNV-1a 32-bit × two seeds → 16 hex chars, take 10.
  let h1 = 0x811c9dc5;
  let h2 = 0x811c9dc5 ^ 0x9e3779b9;
  for (let i = 0; i < input.length; i += 1) {
    const c = input.charCodeAt(i);
    h1 ^= c;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= c;
    h2 = Math.imul(h2, 0x01000193);
  }
  const hex =
    (h1 >>> 0).toString(16).padStart(8, "0") + (h2 >>> 0).toString(16).padStart(8, "0");
  return `e${hex.slice(0, 10)}`;
}

/**
 * Short system append when this *thread* enabled eco_agent_browser MCP.
 * Detailed workflow lives in the bundled skill `eco-agent-browser`.
 * Server name is always `eco_agent_browser`; isolation is auth-token + Eco gateway routing.
 */
export function buildEcoAgentBrowserPromptAppend(_threadId?: string): string {
  return [
    "Built-in browser (Eco): tools run against the *current conversation thread* only.",
    "That thread may have multiple independent browser surfaces (WebContents); list/switch them via agent-browser tab / CDP targets.",
    "MCP server `eco_agent_browser` is Eco-hosted: each connection is bound to this conversation (auth token / tool claims) — never another thread's open pages.",
    "Site data (cookies / localStorage / IndexedDB) is shared across conversations in the same workspace (login once, reuse).",
    "When `mcp__eco_agent_browser__*` tools are available, ALWAYS use them.",
    "Do NOT pass a custom `session` argument (or session=__active__/web/chat) — Eco binds one short session per conversation thread.",
    "Do NOT shell `agent-browser` CLI (`Bash`/`agent-browser open|--headed|tab`).",
    "Do NOT read or follow `~/.agents/skills/agent-browser` or external agent-browser skills; use Skill `eco-agent-browser` only.",
    "Do not use macOS `open` / a separate Chrome when this integration is available for the thread.",
    `Prefer Skill \`${ECO_AGENT_BROWSER_SKILL_NAME}\` for the snapshot-and-ref workflow.`,
  ].join("\n");
}

export const ECO_AGENT_BROWSER_PROMPT_APPEND = buildEcoAgentBrowserPromptAppend();

/** @deprecated Multi-name servers removed — always use {@link ECO_AGENT_BROWSER_MCP_SERVER}. */
export function ecoAgentBrowserRuntimeServerName(_threadId: string): string {
  return ECO_AGENT_BROWSER_MCP_SERVER;
}

export function ecoAgentBrowserAllowedToolPatternForThread(_threadId?: string): string {
  return ECO_AGENT_BROWSER_ALLOWED_TOOL;
}

/** True for the logical eco browser MCP server name. */
export function isEcoAgentBrowserRuntimeServerName(name: string): boolean {
  const n = name.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
  return n === ECO_AGENT_BROWSER_MCP_SERVER || /^eco_ab_e[a-f0-9]{10}$/.test(n);
}

/** Whether Agent may open/navigate URLs without a human click. */
export type BrowserOpenApprovalMode = "always_allow" | "always_ask";

export const BROWSER_OPEN_APPROVAL_MODES = ["always_allow", "always_ask"] as const;

export function isBrowserOpenApprovalMode(value: unknown): value is BrowserOpenApprovalMode {
  return (
    typeof value === "string" &&
    (BROWSER_OPEN_APPROVAL_MODES as readonly string[]).includes(value)
  );
}

export interface BrowserSettingsSnapshot {
  /**
   * When true, `eco_agent_browser` may appear in Composer/workpanel MCP toggles.
   * Does not inject into sessions; each thread enables via mcpServersEnabled.
   */
  agentIntegrationEnabled: boolean;
  /**
   * When Agent calls agent_browser_open / tab_new (open a site).
   * always_allow auto-approves; always_ask shows the same approval card as tools.
   */
  openApprovalMode: BrowserOpenApprovalMode;
}

export function defaultBrowserSettings(): BrowserSettingsSnapshot {
  return {
    agentIntegrationEnabled: false,
    openApprovalMode: "always_allow",
  };
}

export function normalizeBrowserSettingsSnapshot(value: unknown): BrowserSettingsSnapshot {
  if (!value || typeof value !== "object") {
    return defaultBrowserSettings();
  }
  const record = value as Record<string, unknown>;
  return {
    agentIntegrationEnabled: record.agentIntegrationEnabled === true,
    openApprovalMode: isBrowserOpenApprovalMode(record.openApprovalMode)
      ? record.openApprovalMode
      : "always_allow",
  };
}

export function isBrowserSettingsSnapshot(value: unknown): value is BrowserSettingsSnapshot {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.agentIntegrationEnabled !== "boolean") {
    return false;
  }
  if (record.openApprovalMode !== undefined && !isBrowserOpenApprovalMode(record.openApprovalMode)) {
    return false;
  }
  return true;
}

/** Whether tools from the eco browser MCP may be auto-approved via allowedTools. */
export function shouldAutoApproveEcoAgentBrowserTools(mode: BrowserOpenApprovalMode): boolean {
  return mode === "always_allow";
}

/**
 * Tools that *open or create* a navigation surface — gated by openApprovalMode.
 * Snapshot / click / fill are not included (they do not choose a new site by URL).
 */
export function requiresBrowserOpenApproval(toolName: string): boolean {
  const name = toolName.trim().toLowerCase();
  if (!name) {
    return false;
  }
  const isEcoBrowser =
    name.includes("eco_agent_browser") ||
    name.includes("mcp__eco_agent_browser") ||
    name.includes("mcp__eco_ab_") ||
    name.includes("agent_browser_");
  if (!isEcoBrowser) {
    return false;
  }
  if (name.includes("agent_browser_open")) {
    return true;
  }
  if (name.includes("agent_browser_tab_new") || name.includes("tab_new")) {
    return true;
  }
  // navigate / goto when present in the tool name
  if (name.includes("navigate") || name.includes("goto")) {
    return true;
  }
  return false;
}

export interface BrowserPanelBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type BrowserInstanceSource = "human" | "agent";

export interface BrowserInstanceView {
  id: string;
  threadId: string;
  url: string;
  title: string;
  /** Page favicon URL from WebContents (`page-favicon-updated`), when available. */
  faviconUrl?: string;
  isLoading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  focused: boolean;
  source: BrowserInstanceSource;
  createdAt: number;
}

/** First usable favicon from Chromium's page-favicon-updated list. */
export function pickBrowserFaviconUrl(favicons: readonly string[] | undefined): string | undefined {
  if (!favicons?.length) {
    return undefined;
  }
  for (const raw of favicons) {
    const url = raw.trim();
    if (!url) {
      continue;
    }
    if (
      url.startsWith("data:image/") ||
      url.startsWith("https://") ||
      url.startsWith("http://")
    ) {
      return url;
    }
  }
  return undefined;
}

export interface BrowserViewState {
  /** UI scope currently bound for chrome / tab list (active thread or personal). */
  uiScopeId: string;
  instances: BrowserInstanceView[];
  focusedBrowserId?: string;
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
   * When set, renderer should open/select the task tab for this browser id.
   * Cleared once the focused browser panel becomes visible via setVisible(true).
   */
  revealBrowserId?: string;
}

export interface BrowserNavigateRequest {
  url: string;
  browserId?: string;
  threadId?: string;
  /** Open the dock (renderer should show panel). Main still navigates regardless. */
  reveal?: boolean;
}

export interface BrowserOpenRequest {
  url?: string;
  threadId?: string;
  browserId?: string;
  reveal?: boolean;
  /** When true, open a new browser even if none focused. */
  newBrowser?: boolean;
}

export interface BrowserFocusRequest {
  browserId: string;
  reveal?: boolean;
}

export interface BrowserCloseRequest {
  browserId: string;
}

export interface BrowserSetBoundsRequest {
  bounds: BrowserPanelBounds;
  browserId?: string;
}

export interface BrowserSetVisibleRequest {
  visible: boolean;
  browserId?: string;
}

export interface BrowserSetUiScopeRequest {
  threadId: string | null;
}

export function browserTaskTabId(browserId: string): string {
  return `${BROWSER_TASK_TAB_PREFIX}${browserId}`;
}

export function parseBrowserTaskTabId(tabId: string): string | undefined {
  if (!tabId.startsWith(BROWSER_TASK_TAB_PREFIX)) {
    return undefined;
  }
  const id = tabId.slice(BROWSER_TASK_TAB_PREFIX.length).trim();
  return id || undefined;
}

export function isBrowserTaskTabId(tabId: string): boolean {
  return Boolean(parseBrowserTaskTabId(tabId));
}

/**
 * Electron session partition for site data (cookies, localStorage, IndexedDB).
 * Shared by all Eco threads in the same workspace — Cursor-style workspace persist.
 * Open pages / CDP targets stay per-thread in BrowserHost; only the storage bucket is shared.
 */
export function partitionForBrowserWorkspace(workspaceKey: string): string {
  const input = workspaceKey.trim() || ECO_BROWSER_PERSONAL_SCOPE_ID;
  // Normalize path separators so macOS/Windows of the same folder map to one bag.
  const normalized = input.replace(/\\/g, "/").replace(/\/+$/, "") || "/";
  // Hash: absolute workspace paths are too long / noisy for partition names.
  let h1 = 0x811c9dc5;
  let h2 = 0x811c9dc5 ^ 0x9e3779b9;
  for (let i = 0; i < normalized.length; i += 1) {
    const c = normalized.charCodeAt(i);
    h1 ^= c;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= c;
    h2 = Math.imul(h2, 0x01000193);
  }
  const hex =
    (h1 >>> 0).toString(16).padStart(8, "0") + (h2 >>> 0).toString(16).padStart(8, "0");
  return `persist:eco-browser-w-${hex.slice(0, 16)}`;
}

/** @deprecated Use {@link partitionForBrowserWorkspace}. Kept for call-site migration. */
export function partitionForBrowserScope(scopeId: string): string {
  return partitionForBrowserWorkspace(scopeId);
}

export function isEcoAgentBrowserEnabledInSettingsMap(
  mcpServersEnabled: Record<string, boolean> | undefined,
): boolean {
  return mcpServersEnabled?.[ECO_AGENT_BROWSER_MCP_SERVER] === true;
}

export function isBrowserHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/** True when agent open(url) must not replace an existing non-blank page with another site. */
export function shouldOpenAgentUrlInNewBrowser(currentUrl: string, nextUrl: string): boolean {
  const cur = currentUrl.trim();
  if (!cur || cur === "about:blank") {
    return false;
  }
  try {
    const a = new URL(cur);
    const b = new URL(
      nextUrl.includes("://") ? nextUrl : `https://${nextUrl.replace(/^\/+/, "")}`,
    );
    return a.origin !== b.origin;
  } catch {
    return true;
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
  // Do not promote Eco event labels / tool status strings into https://hosts
  // e.g. "tool.started", "tool.completed" → would become garbage navigations.
  if (isNonNavigablePseudoHost(trimmed)) {
    return undefined;
  }
  if (/^[\w.-]+\.[a-z]{2,}([/:?#].*)?$/i.test(trimmed) && !/\s/.test(trimmed)) {
    const withScheme = `https://${trimmed}`;
    return isBrowserHttpUrl(withScheme) ? withScheme : undefined;
  }
  return undefined;
}

/** Status / event tokens that look like hostnames but must never open a browser tab. */
export function isNonNavigablePseudoHost(raw: string): boolean {
  const text = raw.trim().toLowerCase();
  if (!text) {
    return false;
  }
  if (/^tool\.(started|completed|result|error|failed|running|pending)/i.test(text)) {
    return true;
  }
  if (/^(bash|mcp|agent)[_-](approval|elicitation)?\./i.test(text)) {
    return true;
  }
  // Bare event types without path
  if (/^(tool|event|status)\.[a-z0-9_.-]+$/i.test(text)) {
    return true;
  }
  return false;
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
 * Surface a browser task tab only for "open / go somewhere" CDP commands.
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
    detail.method === "Page.reload" ||
    detail.method === "Target.createTarget" ||
    detail.method === "Target.activateTarget"
  );
}

/** MCP / SDK tool names that mean agent-browser open / navigate on a session guest. */
export function isEcoAgentBrowserOpenToolName(toolName: string): boolean {
  // Open / tab_new only — snapshot/click must not mint browser tabs from tool.started.
  return requiresBrowserOpenApproval(toolName);
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
  ];
  if (typeof root.tool === "object" && root.tool && !Array.isArray(root.tool)) {
    const tool = root.tool as Record<string, unknown>;
    bags.push(tool.url, tool.input, tool.arguments, tool.tool_input);
  }
  for (const candidate of bags) {
    if (typeof candidate === "string") {
      // Only accept explicit URLs or host-looking strings that are not event labels.
      const normalized = normalizeBrowserNavigateUrl(candidate);
      if (normalized) {
        return normalized;
      }
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
    }
  }
  return undefined;
}

function extractUrlFromLooseText(text: string): string | undefined {
  const trimmed = text.trim();
  if (!trimmed) {
    return undefined;
  }
  if (isNonNavigablePseudoHost(trimmed)) {
    return undefined;
  }
  // Prefer explicit http(s) only when scanning free text — avoid bare host false positives.
  const match = trimmed.match(/https?:\/\/[^\s"'<>]+/i);
  if (match?.[0]) {
    return normalizeBrowserNavigateUrl(match[0]);
  }
  return undefined;
}
