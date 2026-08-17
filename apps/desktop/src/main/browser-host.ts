import {
  ECO_AGENT_BROWSER_ALLOWED_TOOL,
  ECO_AGENT_BROWSER_MCP_SERVER,
  ECO_AGENT_BROWSER_PROMPT_APPEND,
  ECO_BROWSER_PERSONAL_SCOPE_ID,
  appendBrowserPrompt,
  type BrowserInstanceSource,
  type BrowserInstanceView,
  type BrowserPanelBounds,
  type BrowserViewState,
  isBrowserHttpUrl,
  normalizeBrowserNavigateUrl,
  planAdoptPersonalBrowsersToThread,
  resolveBrowserScopePartition,
  pickBrowserFaviconUrl,
  shouldAutoApproveEcoAgentBrowserTools,
  shouldRevealBrowserForCdpActivity,
  browserAgentSessionKey,
  shouldOpenAgentUrlInNewBrowser,
  buildEcoAgentBrowserPromptAppend,
} from "../shared/browser";
import type { McpSdkConfig } from "../shared/mcp";
import {
  resolveAgentBrowserBinary,
} from "./agent-browser-resolve";
import {
  BrowserMcpGateway,
  mergeEcoBrowserSdkConfig,
} from "./browser-mcp-gateway";
import {
  type BrowserCdpProxy,
  type BrowserCdpTarget,
  startMultiBrowserCdpProxy,
} from "./browser-cdp-proxy";
import type { BrowserSettingsStore } from "./browser-settings-store";
import type { CodexMcpServerForConfigSync } from "@eco/runtime";
import type { BrowserWindow, WebContents } from "electron";
import { WebContentsView, session, shell } from "electron";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

export { appendBrowserPrompt };

const HOME_URL = "about:blank";

function resolveAgentBrowserSocketDir(): string {
  try {
    const require = createRequire(import.meta.url);
    const electron = require("electron") as {
      app?: { getPath?: (name: string) => string };
    };
    const userData = electron.app?.getPath?.("userData");
    if (userData?.trim()) {
      // Short base path — nested thr_* dirs made sock paths exceed AF_UNIX limits.
      return path.join(userData, "ab");
    }
  } catch {
    // fall through
  }
  return path.join(process.cwd(), ".eco-ab");
}

function ensureAgentBrowserRuntimeEnv(
  cdpPort: number,
  threadId: string,
): Record<string, string> {
  const sessionKey = browserAgentSessionKey(threadId);
  // Session key is itself the sock namespace leaf (short).
  const socketDir = path.join(resolveAgentBrowserSocketDir(), sessionKey);
  try {
    fs.mkdirSync(socketDir, { recursive: true });
  } catch {
    // Agent may still fail later; injection keeps trying with the path.
  }
  return {
    AGENT_BROWSER_SOCKET_DIR: socketDir,
    AGENT_BROWSER_SESSION: sessionKey,
    AGENT_BROWSER_CDP: String(cdpPort),
    // Eco owns page lifetime; disable daemon idle close + reduce cycle churn.
    AGENT_BROWSER_IDLE_TIMEOUT_MS: "0",
    AGENT_BROWSER_AUTOSAVE_INTERVAL_MS: "0",
  };
}

export type AgentBrowserMcpInjection = {
  enabled: boolean;
  serverName: string;
  sdkEntry?: Record<string, unknown>;
  codexServer?: CodexMcpServerForConfigSync;
  allowedToolPattern?: string;
  /** When false, open tools hit canUseTool for always_ask approval. */
  autoApproveTools?: boolean;
  promptAppend?: string;
  unavailableReason?: string;
  cdpPort?: number;
};

export interface SharedBrowserOpenOptions {
  url?: string;
  revealUi?: boolean;
  threadId?: string | null;
  browserId?: string;
  newBrowser?: boolean;
  source?: BrowserInstanceSource;
  /** Landing open: workspace for personal-scope cookie partition alignment. */
  workspacePath?: string;
}

export interface BrowserHostDeps {
  getMainWindow: () => BrowserWindow | undefined;
  getSettings: () => BrowserSettingsStore;
  broadcast: (state: BrowserViewState) => void;
  /**
   * Resolve project/workspace path for a thread id (not personal scope).
   * Required so cookie partitions stay workspace-scoped rather than per-thread.
   */
  resolveWorkspacePath: (threadId: string) => string | undefined;
}

interface SessionBrowser {
  id: string;
  view: WebContentsView;
  createdAt: number;
  source: BrowserInstanceSource;
  /** Last favicon from `page-favicon-updated` for this guest surface. */
  faviconUrl?: string;
}

interface ThreadBrowserScope {
  threadId: string;
  browsers: Map<string, SessionBrowser>;
  focusedBrowserId?: string | undefined;
  cdp?: BrowserCdpProxy | undefined;
  cdpStarting?: Promise<number> | undefined;
  partition: string;
}

/**
 * Per-thread multi-browser host (pages / focus / CDP).
 * Site data (cookies etc.) uses one Electron partition per workspace (shared login across threads).
 * - Humans: task-panel Tab per browser; only focused guest receives bounds.
 * - Agents: thread-scoped multi-target CDP; MCP inject only when session enables eco_agent_browser.
 */
export class BrowserHost {
  private readonly scopes = new Map<string, ThreadBrowserScope>();
  /** Scope id used for UI chrome / instance list (active thread or personal). */
  private uiScopeId: string = ECO_BROWSER_PERSONAL_SCOPE_ID;
  private visible = false;
  private bounds: BrowserPanelBounds = { x: 0, y: 0, width: 0, height: 0 };
  private disposed = false;
  private revealBrowserId: string | undefined;
  private browserMcpGateway: BrowserMcpGateway | undefined;

  constructor(private readonly deps: BrowserHostDeps) {}

  private gateway(): BrowserMcpGateway {
    if (!this.browserMcpGateway) {
      this.browserMcpGateway = new BrowserMcpGateway({
        ensureCdpPort: (threadId) => this.ensureCdpPort(threadId),
        agentBrowserEnv: (cdpPort, threadId) => ensureAgentBrowserRuntimeEnv(cdpPort, threadId),
      });
    }
    return this.browserMcpGateway;
  }

  /** FIFO claim for concurrent Codex→shared MCP process isolation. */
  noteBrowserToolStarted(threadId: string, toolName?: string): void {
    this.gateway().noteUpcomingTool(threadId, toolName);
  }
  getState(): BrowserViewState {
    const settings = this.deps.getSettings().get();
    const resolved = resolveAgentBrowserBinary();
    const scope = this.scopes.get(this.uiScopeId);
    const instances = this.listInstancesForScope(this.uiScopeId);
    const focusedId = scope?.focusedBrowserId;
    const focused = focusedId ? scope?.browsers.get(focusedId) : undefined;
    const wc = focused?.view.webContents;
    const cdpPort = scope?.cdp?.port;
    return {
      uiScopeId: this.uiScopeId,
      instances,
      ...(focusedId ? { focusedBrowserId: focusedId } : {}),
      url: wc && !wc.isDestroyed() ? wc.getURL() || HOME_URL : HOME_URL,
      title: wc && !wc.isDestroyed() ? wc.getTitle() || "" : "",
      canGoBack: Boolean(
        wc &&
          !wc.isDestroyed() &&
          (wc.navigationHistory?.canGoBack?.() ??
            (typeof wc.canGoBack === "function" ? wc.canGoBack() : false)),
      ),
      canGoForward: Boolean(
        wc &&
          !wc.isDestroyed() &&
          (wc.navigationHistory?.canGoForward?.() ??
            (typeof wc.canGoForward === "function" ? wc.canGoForward() : false)),
      ),
      isLoading: Boolean(wc && !wc.isDestroyed() && wc.isLoading()),
      visible: this.visible,
      ...(typeof cdpPort === "number" ? { cdpPort } : {}),
      agentIntegrationEnabled: settings.agentIntegrationEnabled,
      agentBrowserAvailable: resolved.available,
      ...(resolved.reason ? { agentBrowserUnavailableReason: resolved.reason } : {}),
      ...(this.revealBrowserId ? { revealBrowserId: this.revealBrowserId } : {}),
    };
  }

  setUiScope(threadId: string | null): BrowserViewState {
    const next = threadId?.trim() ? threadId.trim() : ECO_BROWSER_PERSONAL_SCOPE_ID;
    if (next !== this.uiScopeId) {
      // Always park every WebContentsView before switching — leftover views cover the HTML UI.
      this.hideAllViews();
      this.uiScopeId = next;
      this.revealBrowserId = undefined;
      if (this.visible) {
        this.applyBoundsToFocused();
      }
    } else if (!this.visible) {
      this.hideAllViews();
    }
    this.emit();
    return this.getState();
  }

  getUiScopeId(): string {
    return this.uiScopeId;
  }

  private emit(): void {
    if (this.disposed) return;
    this.deps.broadcast(this.getState());
  }

  private listInstancesForScope(scopeId: string): BrowserInstanceView[] {
    const scope = this.scopes.get(scopeId);
    if (!scope) {
      return [];
    }
    return [...scope.browsers.values()].map((browser) => {
      const wc = browser.view.webContents;
      const alive = wc && !wc.isDestroyed();
      const faviconUrl = browser.faviconUrl?.trim();
      return {
        id: browser.id,
        threadId: scope.threadId,
        url: alive ? wc.getURL() || HOME_URL : HOME_URL,
        title: alive ? wc.getTitle() || "" : "",
        ...(faviconUrl ? { faviconUrl } : {}),
        isLoading: Boolean(alive && wc.isLoading()),
        canGoBack: Boolean(
          alive &&
            (wc.navigationHistory?.canGoBack?.() ??
              (typeof wc.canGoBack === "function" ? wc.canGoBack() : false)),
        ),
        canGoForward: Boolean(
          alive &&
            (wc.navigationHistory?.canGoForward?.() ??
              (typeof wc.canGoForward === "function" ? wc.canGoForward() : false)),
        ),
        focused: scope.focusedBrowserId === browser.id,
        source: browser.source,
        createdAt: browser.createdAt,
      };
    });
  }

  private resolvePartition(scopeId: string, workspaceHint?: string | null): string {
    if (scopeId === ECO_BROWSER_PERSONAL_SCOPE_ID) {
      return resolveBrowserScopePartition(scopeId, {
        workspacePath: workspaceHint,
      });
    }
    const workspacePath =
      workspaceHint?.trim() || this.deps.resolveWorkspacePath(scopeId)?.trim();
    return resolveBrowserScopePartition(scopeId, { workspacePath });
  }

  private ensureScope(scopeId: string, workspaceHint?: string | null): ThreadBrowserScope {
    let scope = this.scopes.get(scopeId);
    if (scope) {
      return scope;
    }
    scope = {
      threadId: scopeId,
      browsers: new Map(),
      partition: this.resolvePartition(scopeId, workspaceHint),
    };
    this.scopes.set(scopeId, scope);
    return scope;
  }

  private resolveScopeId(threadId?: string | null): string {
    if (threadId === null) {
      return ECO_BROWSER_PERSONAL_SCOPE_ID;
    }
    if (typeof threadId === "string" && threadId.trim()) {
      return threadId.trim();
    }
    return this.uiScopeId;
  }

  private hideAllViews(): void {
    for (const scope of this.scopes.values()) {
      for (const browser of scope.browsers.values()) {
        if (!browser.view.webContents.isDestroyed()) {
          browser.view.setVisible(false);
          browser.view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
        }
      }
    }
  }

  /**
   * Whether this guest is currently painted for human interaction.
   * Hidden / zero-bounds agent shells must not steal keyboard focus from the main UI.
   */
  private isGuestPaintedForHuman(browserId: string): boolean {
    if (!this.visible || this.bounds.width < 1 || this.bounds.height < 1) {
      return false;
    }
    const scope = this.scopes.get(this.uiScopeId);
    return scope?.focusedBrowserId === browserId;
  }

  /**
   * Snapshot main-renderer keyboard focus before guest create/load.
   * Electron WebContentsView creation and navigation routinely move first-responder
   * off the HTML UI even when the guest is invisible (agent background open).
   */
  private captureMainRendererFocus(): boolean {
    const win = this.deps.getMainWindow();
    if (!win || win.isDestroyed() || !win.isFocused()) {
      return false;
    }
    try {
      return win.webContents.isFocused();
    } catch {
      return true;
    }
  }

  private restoreMainRendererFocus(hadMainFocus: boolean): void {
    if (!hadMainFocus) {
      return;
    }
    const win = this.deps.getMainWindow();
    if (!win || win.isDestroyed() || !win.isFocused()) {
      return;
    }
    try {
      if (!win.webContents.isFocused()) {
        win.webContents.focus();
      }
    } catch {
      // ignore
    }
  }

  /**
   * Restore after async steal (loadURL / CDP attach). Schedule a micro-delay so
   * Chromium's post-navigation focus promotion is covered.
   */
  private preserveMainRendererFocusAfterGuestWork(hadMainFocus: boolean): void {
    this.restoreMainRendererFocus(hadMainFocus);
    if (!hadMainFocus) {
      return;
    }
    setTimeout(() => this.restoreMainRendererFocus(true), 0);
    setTimeout(() => this.restoreMainRendererFocus(true), 50);
  }

  private createBrowserInScope(
    scope: ThreadBrowserScope,
    source: BrowserInstanceSource,
  ): SessionBrowser {
    const win = this.deps.getMainWindow();
    if (!win || win.isDestroyed()) {
      throw new Error("主窗口不可用，无法创建内置浏览器。");
    }

    const guestSession = session.fromPartition(scope.partition);
    guestSession.setPermissionRequestHandler((_wc, _permission, callback) => {
      callback(false);
    });

    const id = randomUUID();
    const hadMainFocus = this.captureMainRendererFocus();
    const view = new WebContentsView({
      webPreferences: {
        session: guestSession,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        javascript: true,
      },
    });

    view.webContents.setWindowOpenHandler(({ url }) => {
      if (isBrowserHttpUrl(url)) {
        try {
          // OAuth / identity popups must become real Eco tabs so the sidebar and
          // agent tab_list stay aligned (same-tab load made Agent report wrong counts).
          const created = this.createBrowserInScope(scope, source);
          scope.focusedBrowserId = created.id;
          this.requestReveal(created.id);
          const preserve = this.captureMainRendererFocus();
          void created.view.webContents.loadURL(url).then(() => {
            scope.cdp?.notifyTargetInfoChanged(created.id);
            this.preserveMainRendererFocusAfterGuestWork(preserve);
            this.emit();
          });
        } catch {
          // ignore
        }
      }
      return { action: "deny" };
    });

    const browser: SessionBrowser = {
      id,
      view,
      createdAt: Date.now(),
      source,
    };

    const onNav = (_event: unknown, url?: string) => {
      const target =
        typeof url === "string" && url.trim()
          ? url
          : !view.webContents.isDestroyed()
            ? view.webContents.getURL()
            : "";
      if (isBrowserHttpUrl(target) && scope.focusedBrowserId === id) {
        this.requestReveal(id);
      }
      scope.cdp?.notifyTargetInfoChanged(id);
      this.emit();
    };
    view.webContents.on("did-start-loading", () => this.emit());
    view.webContents.on("did-stop-loading", () => {
      scope.cdp?.notifyTargetInfoChanged(id);
      this.emit();
    });
    view.webContents.on("did-start-navigation", (_event, _url, isInPlace, isMainFrame) => {
      // Full document navigations drop the previous page icon until the next favicon event.
      if (isMainFrame && !isInPlace) {
        if (browser.faviconUrl) {
          browser.faviconUrl = undefined;
          this.emit();
        }
      }
    });
    view.webContents.on("did-navigate", onNav);
    view.webContents.on("did-navigate-in-page", onNav);
    view.webContents.on("page-title-updated", () => {
      scope.cdp?.notifyTargetInfoChanged(id);
      this.emit();
    });
    view.webContents.on("page-favicon-updated", (_event, favicons) => {
      const next = pickBrowserFaviconUrl(favicons);
      if (next === browser.faviconUrl) {
        return;
      }
      browser.faviconUrl = next;
      this.emit();
    });
    view.webContents.on("did-fail-load", () => this.emit());
    // Background guest must not hold first-responder while the human is in chat/composer.
    view.webContents.on("focus", () => {
      if (!this.isGuestPaintedForHuman(id)) {
        this.restoreMainRendererFocus(true);
      }
    });

    win.contentView.addChildView(view);
    view.setVisible(false);
    view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
    void view.webContents.loadURL(HOME_URL).finally(() => {
      this.preserveMainRendererFocusAfterGuestWork(hadMainFocus);
    });

    scope.browsers.set(id, browser);
    if (!scope.focusedBrowserId) {
      scope.focusedBrowserId = id;
    }
    scope.cdp?.notifyTargetCreated(id);
    this.preserveMainRendererFocusAfterGuestWork(hadMainFocus);
    return browser;
  }

  private requestReveal(browserId: string): void {
    // Only signal the renderer when the human panel is already showing this tab's scope.
    if (!this.visible) {
      return;
    }
    const found = this.findBrowser(browserId);
    if (!found || found.scope.threadId !== this.uiScopeId) {
      return;
    }
    this.revealBrowserId = browserId;
  }

  /**
   * Paint at most one focused guest for the current UI scope, and force every other
   * WebContentsView (all scopes) off — prevents orphans overlaying the chat HTML.
   */
  private applyBoundsToFocused(): void {
    for (const scope of this.scopes.values()) {
      for (const browser of scope.browsers.values()) {
        if (browser.view.webContents.isDestroyed()) continue;
        const isFocused =
          this.visible &&
          scope.threadId === this.uiScopeId &&
          browser.id === scope.focusedBrowserId &&
          this.bounds.width >= 1 &&
          this.bounds.height >= 1;
        if (!isFocused) {
          browser.view.setVisible(false);
          browser.view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
        } else {
          browser.view.setBounds(this.bounds);
          browser.view.setVisible(true);
        }
      }
    }
  }

  private findBrowser(
    browserId: string,
  ): { scope: ThreadBrowserScope; browser: SessionBrowser } | undefined {
    for (const scope of this.scopes.values()) {
      const browser = scope.browsers.get(browserId);
      if (browser) {
        return { scope, browser };
      }
    }
    return undefined;
  }

  async openSharedSession(options: SharedBrowserOpenOptions = {}): Promise<BrowserViewState> {
    const revealUi = options.revealUi !== false;
    const scopeId = this.resolveScopeId(options.threadId);
    const source = options.source ?? "human";
    // Agents must not hijack human UI scope (other chats would steal the panel).
    if (source !== "agent") {
      if (options.threadId !== undefined) {
        this.uiScopeId = scopeId;
      } else if (scopeId !== this.uiScopeId) {
        this.uiScopeId = scopeId;
      }
    }

    const scope = this.ensureScope(scopeId, options.workspacePath);
    let browser: SessionBrowser | undefined;
    if (options.browserId) {
      browser = scope.browsers.get(options.browserId);
    }
    if (!browser && options.newBrowser) {
      browser = this.createBrowserInScope(scope, source);
    }
    if (!browser && scope.focusedBrowserId) {
      browser = scope.browsers.get(scope.focusedBrowserId);
    }
    if (!browser) {
      browser = this.createBrowserInScope(scope, source);
    }
    scope.focusedBrowserId = browser.id;

    if (revealUi && source !== "agent") {
      this.requestReveal(browser.id);
    } else if (revealUi && source === "agent") {
      // Soft: only tag for renderer if user already has this thread's panel open.
      this.requestReveal(browser.id);
    }

    const raw = options.url?.trim();
    // Agent open/load often steals first-responder even with the guest still hidden.
    const hadMainFocus = this.captureMainRendererFocus();
    if (raw !== undefined && raw.length > 0) {
      const url =
        normalizeBrowserNavigateUrl(raw) ??
        (raw === HOME_URL || raw === "about:blank" ? HOME_URL : undefined);
      if (!url) {
        throw new Error("无效的 URL");
      }
      await browser.view.webContents.loadURL(url);
      scope.cdp?.notifyTargetInfoChanged(browser.id);
    }

    if (this.visible && this.uiScopeId === scopeId) {
      this.applyBoundsToFocused();
    } else {
      this.hideAllViews();
      // Keep focused scope ready if panel is open on another thread — re-paint that one.
      if (this.visible) {
        this.applyBoundsToFocused();
      }
    }
    // Only keep the restored focus when the guest is not the active painted pane
    // (agent background open / other-thread CDP). Human-visible panel may hold focus.
    if (!this.isGuestPaintedForHuman(browser.id)) {
      this.preserveMainRendererFocusAfterGuestWork(hadMainFocus);
    }
    this.emit();
    return this.getState();
  }

  focusBrowser(browserId: string, options?: { reveal?: boolean }): BrowserViewState {
    const found = this.findBrowser(browserId);
    if (!found) {
      throw new Error(`Browser not found: ${browserId}`);
    }
    this.uiScopeId = found.scope.threadId;
    found.scope.focusedBrowserId = browserId;
    if (options?.reveal !== false) {
      this.requestReveal(browserId);
    }
    if (this.visible) {
      this.applyBoundsToFocused();
    }
    this.emit();
    return this.getState();
  }

  closeBrowser(browserId: string): BrowserViewState {
    const found = this.findBrowser(browserId);
    if (!found) {
      return this.getState();
    }
    const { scope, browser } = found;
    this.destroyBrowser(scope, browser);
    // Tell connected agent-browser MCP clients the page is gone (stale tab_list otherwise).
    scope.cdp?.notifyTargetDestroyed(browserId);
    if (scope.focusedBrowserId === browserId) {
      const next = scope.browsers.keys().next();
      scope.focusedBrowserId = next.done ? undefined : next.value;
    }
    if (this.revealBrowserId === browserId) {
      this.revealBrowserId = scope.focusedBrowserId;
    }
    if (this.visible) {
      this.applyBoundsToFocused();
    }
    this.emit();
    return this.getState();
  }

  private destroyBrowser(scope: ThreadBrowserScope, browser: SessionBrowser): void {
    const win = this.deps.getMainWindow();
    try {
      if (win && !win.isDestroyed()) {
        win.contentView.removeChildView(browser.view);
      }
    } catch {
      // ignore
    }
    try {
      if (!browser.view.webContents.isDestroyed()) {
        browser.view.webContents.close();
      }
    } catch {
      // ignore
    }
    scope.browsers.delete(browser.id);
  }

  setVisible(visible: boolean, browserId?: string): BrowserViewState {
    if (browserId) {
      const found = this.findBrowser(browserId);
      if (found) {
        this.uiScopeId = found.scope.threadId;
        if (visible) {
          found.scope.focusedBrowserId = browserId;
        }
      }
    }
    if (visible) {
      this.visible = true;
      if (this.revealBrowserId) {
        const focused = this.scopes.get(this.uiScopeId)?.focusedBrowserId;
        if (focused === this.revealBrowserId || !this.revealBrowserId) {
          this.revealBrowserId = undefined;
        } else if (browserId && browserId === this.revealBrowserId) {
          this.revealBrowserId = undefined;
        } else if (browserId) {
          this.revealBrowserId = undefined;
        }
      }
      this.applyBoundsToFocused();
    } else if (browserId) {
      // Per-tab hide only — do not set panel-level visible=false (tab switches would race
      // and blank the newly focused WebContentsView).
      const found = this.findBrowser(browserId);
      if (found && !found.browser.view.webContents.isDestroyed()) {
        found.browser.view.setVisible(false);
        found.browser.view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
      }
      // Re-apply for any still-focused sibling if panel is up.
      if (this.visible) {
        this.applyBoundsToFocused();
      }
    } else {
      this.visible = false;
      this.revealBrowserId = undefined;
      this.hideAllViews();
    }
    this.emit();
    return this.getState();
  }

  setBounds(bounds: BrowserPanelBounds, browserId?: string): BrowserViewState {
    this.bounds = {
      x: Math.max(0, Math.round(bounds.x)),
      y: Math.max(0, Math.round(bounds.y)),
      width: Math.max(0, Math.round(bounds.width)),
      height: Math.max(0, Math.round(bounds.height)),
    };
    if (browserId) {
      const found = this.findBrowser(browserId);
      if (found) {
        this.uiScopeId = found.scope.threadId;
        found.scope.focusedBrowserId = browserId;
      }
    }
    if (this.visible) {
      this.applyBoundsToFocused();
    }
    return this.getState();
  }

  /** @deprecated Prefer openSharedSession */
  async navigate(
    rawUrl: string,
    options?: { reveal?: boolean; browserId?: string; threadId?: string },
  ): Promise<BrowserViewState> {
    return this.openSharedSession({
      url: rawUrl,
      revealUi: options?.reveal !== false,
      ...(options?.browserId ? { browserId: options.browserId } : {}),
      ...(options?.threadId ? { threadId: options.threadId } : {}),
    });
  }

  goBack(browserId?: string): BrowserViewState {
    const browser = this.requireFocusedOrId(browserId);
    const wc = browser.view.webContents;
    if (wc.navigationHistory?.canGoBack?.()) {
      wc.navigationHistory.goBack();
    } else if (typeof wc.canGoBack === "function" && wc.canGoBack()) {
      wc.goBack();
    }
    this.emit();
    return this.getState();
  }

  goForward(browserId?: string): BrowserViewState {
    const browser = this.requireFocusedOrId(browserId);
    const wc = browser.view.webContents;
    if (wc.navigationHistory?.canGoForward?.()) {
      wc.navigationHistory.goForward();
    } else if (typeof wc.canGoForward === "function" && wc.canGoForward()) {
      wc.goForward();
    }
    this.emit();
    return this.getState();
  }

  reload(browserId?: string): BrowserViewState {
    const browser = this.requireFocusedOrId(browserId);
    browser.view.webContents.reload();
    this.emit();
    return this.getState();
  }

  private requireFocusedOrId(browserId?: string): SessionBrowser {
    if (browserId) {
      const found = this.findBrowser(browserId);
      if (!found) {
        throw new Error(`Browser not found: ${browserId}`);
      }
      return found.browser;
    }
    const scope = this.scopes.get(this.uiScopeId);
    const id = scope?.focusedBrowserId;
    const browser = id ? scope?.browsers.get(id) : undefined;
    if (!browser) {
      throw new Error("No focused browser");
    }
    return browser;
  }

  async openExternalCurrent(browserId?: string): Promise<void> {
    const browser = this.requireFocusedOrId(browserId);
    const url = browser.view.webContents.isDestroyed()
      ? ""
      : browser.view.webContents.getURL();
    if (isBrowserHttpUrl(url)) {
      await shell.openExternal(url);
    }
  }

  async notifyAgentBrowserOpen(
    threadId: string,
    url?: string,
    options?: { newTab?: boolean },
  ): Promise<BrowserViewState> {
    // Default: reuse focused tab for pure reloads / open of the same site.
    // Different origin must mint a new page — otherwise a second open("chatgpt.com")
    // overwrites the focused DeepSeek tab (agents then report "覆盖" vs panel reality).
    let newBrowser = Boolean(options?.newTab);
    if (!newBrowser && url) {
      const scope = this.ensureScope(this.resolveScopeId(threadId));
      const focused = scope.focusedBrowserId
        ? scope.browsers.get(scope.focusedBrowserId)
        : undefined;
      const current =
        focused && !focused.view.webContents.isDestroyed()
          ? focused.view.webContents.getURL()
          : "";
      if (shouldOpenAgentUrlInNewBrowser(current, url)) {
        newBrowser = true;
      }
    }
    return this.openSharedSession({
      threadId,
      ...(url ? { url } : {}),
      newBrowser,
      revealUi: true,
      source: "agent",
    });
  }

  /**
   * Ensure CDP multi-target proxy for a thread scope (Agent attach).
   * Does not force human panel open.
   */
  async ensureCdpPort(threadId: string): Promise<number> {
    const scopeId = threadId.trim() || ECO_BROWSER_PERSONAL_SCOPE_ID;
    // Agent must not use personal CDP across threads.
    if (scopeId === ECO_BROWSER_PERSONAL_SCOPE_ID) {
      throw new Error("Agent browser CDP requires a conversation thread id");
    }
    const scope = this.ensureScope(scopeId);
    if (scope.browsers.size === 0) {
      this.createBrowserInScope(scope, "agent");
    }
    if (scope.cdp) {
      return scope.cdp.port;
    }
    if (scope.cdpStarting) {
      return scope.cdpStarting;
    }
    scope.cdpStarting = (async () => {
      const proxy = await startMultiBrowserCdpProxy({
        getTargets: () => this.cdpTargetsForScope(scope),
        onCreateTarget: async (url) => {
          const hadMainFocus = this.captureMainRendererFocus();
          // Prefer existing blank about:blank as the first target instead of stacking shells.
          const created =
            [...scope.browsers.values()].find((b) => {
              if (b.view.webContents.isDestroyed()) {
                return false;
              }
              const current = b.view.webContents.getURL();
              return !current || current === HOME_URL || current === "about:blank";
            }) ?? this.createBrowserInScope(scope, "agent");
          scope.focusedBrowserId = created.id;
          // Never steal human UI scope / force panel open from MCP createTarget.
          this.requestReveal(created.id);
          if (url && (normalizeBrowserNavigateUrl(url) || url === HOME_URL || url === "about:blank")) {
            const target =
              normalizeBrowserNavigateUrl(url) ??
              (url === HOME_URL || url === "about:blank" ? HOME_URL : undefined);
            if (target) {
              await created.view.webContents.loadURL(target);
            }
          }
          if (this.visible && this.uiScopeId === scope.threadId) {
            this.applyBoundsToFocused();
          } else {
            // Keep any painted guest for the active human scope only.
            if (this.visible) {
              this.applyBoundsToFocused();
            } else {
              this.hideAllViews();
            }
          }
          if (!this.isGuestPaintedForHuman(created.id)) {
            this.preserveMainRendererFocusAfterGuestWork(hadMainFocus);
          }
          this.emit();
          return { id: created.id, webContents: created.view.webContents };
        },
        onActivateTarget: (targetId) => {
          if (!scope.browsers.has(targetId)) {
            return;
          }
          scope.focusedBrowserId = targetId;
          this.requestReveal(targetId);
          if (this.visible && this.uiScopeId === scope.threadId) {
            this.applyBoundsToFocused();
          }
          this.emit();
        },
        onCloseTarget: async (targetId) => {
          const browser = scope.browsers.get(targetId);
          if (!browser) {
            return;
          }
          // Agent tab_close maps to Target.closeTarget — must destroy Eco WebContents so
          // sidebar tabs stay aligned with agent-browser tab_list. Idle/autosave close is
          // disabled via AGENT_BROWSER_*_MS=0 so this is intentional agent (or user CDP) close.
          this.destroyBrowser(scope, browser);
          if (scope.focusedBrowserId === targetId) {
            const next = scope.browsers.keys().next();
            scope.focusedBrowserId = next.done ? undefined : next.value;
          }
          if (this.revealBrowserId === targetId) {
            this.revealBrowserId = scope.focusedBrowserId;
          }
          if (this.visible && this.uiScopeId === scope.threadId) {
            this.applyBoundsToFocused();
          } else if (this.visible) {
            this.applyBoundsToFocused();
          } else {
            this.hideAllViews();
          }
          this.emit();
        },
        onClientActivity: (detail) => {
          if (!shouldRevealBrowserForCdpActivity(detail)) {
            return;
          }
          const targetId =
            detail.targetId ??
            scope.focusedBrowserId ??
            [...scope.browsers.keys()][0];
          if (targetId && scope.browsers.has(targetId)) {
            scope.focusedBrowserId = targetId;
          }
          // Soft reveal only when the human is already viewing this thread's panel.
          if (targetId) {
            this.requestReveal(targetId);
          }
          if (this.visible && this.uiScopeId === scope.threadId) {
            this.applyBoundsToFocused();
          }
          this.emit();
        },
      });
      scope.cdp = proxy;
      this.emit();
      return proxy.port;
    })();
    try {
      return await scope.cdpStarting;
    } finally {
      scope.cdpStarting = undefined;
    }
  }

  private cdpTargetsForScope(scope: ThreadBrowserScope): BrowserCdpTarget[] {
    const out: BrowserCdpTarget[] = [];
    for (const browser of scope.browsers.values()) {
      if (!browser.view.webContents.isDestroyed()) {
        out.push({ id: browser.id, webContents: browser.view.webContents });
      }
    }
    return out;
  }

  isFeatureAvailable(): { available: boolean; reason?: string } {
    const settings = this.deps.getSettings().get();
    if (!settings.agentIntegrationEnabled) {
      return { available: false, reason: "内置浏览器 Agent 能力未在设置中开启" };
    }
    const resolved = resolveAgentBrowserBinary();
    if (!resolved.available) {
      return { available: false, reason: resolved.reason ?? "agent-browser 不可用" };
    }
    return { available: true };
  }

  /** Prompt text only when the *session* enabled eco_agent_browser. */
  getAgentPromptAppend(sessionEnabled: boolean, threadId?: string): string | undefined {
    if (!sessionEnabled || !this.deps.getSettings().get().agentIntegrationEnabled) {
      return undefined;
    }
    const tid = threadId?.trim();
    if (!tid) {
      return ECO_AGENT_BROWSER_PROMPT_APPEND;
    }
    return buildEcoAgentBrowserPromptAppend(tid);
  }

  /** Return the stable global Codex MCP definition without creating a thread browser. */
  async resolveGlobalAgentBrowserMcpServer(): Promise<CodexMcpServerForConfigSync | undefined> {
    const settings = this.deps.getSettings().get();
    if (!settings.agentIntegrationEnabled) {
      return undefined;
    }
    const resolved = resolveAgentBrowserBinary();
    if (!resolved.available || !resolved.binaryPath) {
      throw new Error(resolved.reason ?? "agent-browser unavailable");
    }
    return this.gateway().prepareCodexServer();
  }

  /**
   * On-demand injection for a specific thread run.
   * Always logical server name `eco_agent_browser`. Isolation: thread bearer token (Claude)
   * and/or Eco claim queue for concurrent Codex on one shared MCP process.
   */
  async resolveAgentBrowserMcpInjection(input: {
    threadId: string;
    sessionEnabled: boolean;
  }): Promise<AgentBrowserMcpInjection> {
    const settings = this.deps.getSettings().get();
    if (!settings.agentIntegrationEnabled) {
      return { enabled: false, serverName: ECO_AGENT_BROWSER_MCP_SERVER };
    }
    if (!input.sessionEnabled) {
      return { enabled: false, serverName: ECO_AGENT_BROWSER_MCP_SERVER };
    }
    const resolved = resolveAgentBrowserBinary();
    if (!resolved.available || !resolved.binaryPath) {
      return {
        enabled: false,
        serverName: ECO_AGENT_BROWSER_MCP_SERVER,
        unavailableReason: resolved.reason ?? "agent-browser 不可用",
      };
    }
    try {
      const prepared = await this.gateway().prepareThread(input.threadId);
      const autoApproveTools = shouldAutoApproveEcoAgentBrowserTools(settings.openApprovalMode);
      return {
        enabled: true,
        serverName: ECO_AGENT_BROWSER_MCP_SERVER,
        sdkEntry: prepared.sdkEntry,
        codexServer: prepared.codexServer,
        allowedToolPattern: ECO_AGENT_BROWSER_ALLOWED_TOOL,
        autoApproveTools,
        promptAppend: prepared.promptAppend,
        cdpPort: prepared.cdpPort,
      };
    } catch (error) {
      return {
        enabled: false,
        serverName: ECO_AGENT_BROWSER_MCP_SERVER,
        unavailableReason: error instanceof Error ? error.message : String(error),
      };
    }
  }

  mergeIntoSdkMcpConfig(base: McpSdkConfig, injection: AgentBrowserMcpInjection): McpSdkConfig {
    return mergeEcoBrowserSdkConfig(base, {
      enabled: injection.enabled,
      ...(injection.sdkEntry ? { sdkEntry: injection.sdkEntry } : {}),
      autoApproveTools: injection.autoApproveTools,
    });
  }

  /**
   * Move landing (`__personal__`) open pages into a newly created thread so
   * "new chat → open browser → first message" keeps the same WebContents.
   * Future tabs on the thread use the thread workspace partition; existing
   * guests keep the session they were created with.
   */
  async adoptPersonalScopeToThread(threadId: string): Promise<BrowserViewState> {
    const targetId = threadId.trim();
    if (!targetId || targetId === ECO_BROWSER_PERSONAL_SCOPE_ID) {
      throw new Error("adoptPersonalScopeToThread requires a real conversation thread id");
    }

    const personal = this.scopes.get(ECO_BROWSER_PERSONAL_SCOPE_ID);
    const targetWorkspacePath = this.deps.resolveWorkspacePath(targetId);
    const plan = planAdoptPersonalBrowsersToThread({
      personalBrowserCount: personal?.browsers.size ?? 0,
      targetExists: this.scopes.has(targetId),
      targetWorkspacePath,
      personalPartition: personal?.partition ?? resolveBrowserScopePartition(ECO_BROWSER_PERSONAL_SCOPE_ID),
    });

    if (plan.kind === "noop") {
      return this.setUiScope(targetId);
    }

    if (!personal) {
      return this.setUiScope(targetId);
    }

    await this.tearDownScopeCdp(personal);

    if (plan.kind === "rename") {
      this.scopes.delete(ECO_BROWSER_PERSONAL_SCOPE_ID);
      personal.threadId = targetId;
      personal.partition = plan.partitionForFuture;
      this.scopes.set(targetId, personal);
    } else {
      const target = this.ensureScope(targetId, targetWorkspacePath);
      await this.tearDownScopeCdp(target);
      for (const [id, browser] of personal.browsers) {
        target.browsers.set(id, browser);
      }
      if (personal.focusedBrowserId) {
        target.focusedBrowserId = personal.focusedBrowserId;
      }
      target.partition = plan.partitionForFuture;
      personal.browsers.clear();
      personal.focusedBrowserId = undefined;
      this.scopes.delete(ECO_BROWSER_PERSONAL_SCOPE_ID);
    }

    this.uiScopeId = targetId;
    this.revealBrowserId = undefined;
    if (this.visible) {
      this.applyBoundsToFocused();
    } else {
      this.hideAllViews();
    }
    this.emit();
    return this.getState();
  }

  private async tearDownScopeCdp(scope: ThreadBrowserScope): Promise<void> {
    if (scope.cdpStarting) {
      try {
        await scope.cdpStarting;
      } catch {
        // ignore failed start; still clear below
      }
      scope.cdpStarting = undefined;
    }
    if (scope.cdp) {
      await scope.cdp.close();
      scope.cdp = undefined;
    }
  }

  /** Dispose all browsers (and CDP) for a deleted thread. */
  async disposeThreadScope(threadId: string): Promise<void> {
    this.gateway().disposeThread(threadId);
    const scope = this.scopes.get(threadId);
    if (!scope) {
      return;
    }
    if (scope.cdp) {
      await scope.cdp.close();
      scope.cdp = undefined;
    }
    for (const browser of [...scope.browsers.values()]) {
      this.destroyBrowser(scope, browser);
    }
    this.scopes.delete(threadId);
    if (this.uiScopeId === threadId) {
      this.uiScopeId = ECO_BROWSER_PERSONAL_SCOPE_ID;
    }
    this.emit();
  }

  dispose(): void {
    this.disposed = true;
    this.revealBrowserId = undefined;
    void this.browserMcpGateway?.close();
    this.browserMcpGateway = undefined;
    for (const scope of this.scopes.values()) {
      void scope.cdp?.close();
      for (const browser of [...scope.browsers.values()]) {
        this.destroyBrowser(scope, browser);
      }
    }
    this.scopes.clear();
  }
}

export function isWebContentsAlive(wc: WebContents | undefined): wc is WebContents {
  return Boolean(wc && !wc.isDestroyed());
}

/** Pure helper for tests / call sites: session enabled flag from runtime map. */
export function isSessionEcoBrowserEnabled(
  mcpServersEnabled: Record<string, boolean> | undefined,
): boolean {
  return mcpServersEnabled?.[ECO_AGENT_BROWSER_MCP_SERVER] === true;
}
