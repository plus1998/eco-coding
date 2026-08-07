import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import type { BrowserWindow, WebContents } from "electron";
import { WebContentsView, session, shell } from "electron";
import type { CodexMcpServerForConfigSync } from "@eco/runtime";
import {
  ECO_AGENT_BROWSER_ALLOWED_TOOL,
  ECO_AGENT_BROWSER_MCP_SERVER,
  ECO_AGENT_BROWSER_PROMPT_APPEND,
  appendBrowserPrompt,
  type BrowserPanelBounds,
  type BrowserViewState,
  isBrowserHttpUrl,
  normalizeBrowserNavigateUrl,
  shouldRevealBrowserForCdpActivity,
} from "../shared/browser";
import type { McpSdkConfig } from "../shared/mcp";
import {
  buildAgentBrowserMcpArgs,
  resolveAgentBrowserBinary,
} from "./agent-browser-resolve";
import { type BrowserCdpProxy, startBrowserCdpProxy } from "./browser-cdp-proxy";
import type { BrowserSettingsStore } from "./browser-settings-store";

export { appendBrowserPrompt };

/** Single persistent guest session shared by human UI + Agent MCP (CDP). */
const PARTITION = "persist:eco-browser";
const HOME_URL = "about:blank";

function resolveAgentBrowserSocketDir(): string {
  try {
    const require = createRequire(import.meta.url);
    const electron = require("electron") as {
      app?: { getPath?: (name: string) => string };
    };
    const userData = electron.app?.getPath?.("userData");
    if (userData?.trim()) {
      return path.join(userData, "agent-browser-sockets");
    }
  } catch {
    // fall through
  }
  return path.join(process.cwd(), ".eco-agent-browser-sockets");
}

function ensureAgentBrowserRuntimeEnv(cdpPort: number): Record<string, string> {
  const socketDir = resolveAgentBrowserSocketDir();
  try {
    fs.mkdirSync(socketDir, { recursive: true });
  } catch {
    // Agent may still fail later; injection keeps trying with the path.
  }
  return {
    // daemon sockets default to ~/.agent-browser; packaged apps need a known-writable path
    AGENT_BROWSER_SOCKET_DIR: socketDir,
    // belt-and-suspenders with CLI `--cdp` (native binary reads this too)
    AGENT_BROWSER_CDP: String(cdpPort),
  };
}

export type AgentBrowserMcpInjection = {
  enabled: boolean;
  serverName: string;
  sdkEntry?: Record<string, unknown>;
  codexServer?: CodexMcpServerForConfigSync;
  allowedToolPattern?: string;
  promptAppend?: string;
  unavailableReason?: string;
};

export interface SharedBrowserOpenOptions {
  /** Navigate guest to this URL (normalized http(s)/blank). Omit to only ensure session. */
  url?: string;
  /**
   * Ask the renderer to show the browser task tab when the panel is not visible.
   * Human and Agent paths both use this; only `setVisible(true)` from the renderer
   * actually flips `visible` and positions the WebContentsView.
   */
  revealUi?: boolean;
}

export interface BrowserHostDeps {
  getMainWindow: () => BrowserWindow | undefined;
  getSettings: () => BrowserSettingsStore;
  broadcast: (state: BrowserViewState) => void;
}

/**
 * One in-app browser for humans and agents.
 * - Human chrome and Agent MCP always point at the same WebContentsView + partition.
 * - Agent attaches via local CDP; human sees the same page when the task-panel tab is open.
 * - UI visibility is owned by the renderer; navigation while hidden requests panel reveal.
 */
export class BrowserHost {
  private view: WebContentsView | undefined;
  private cdp: BrowserCdpProxy | undefined;
  private cdpStarting: Promise<number> | undefined;
  /** True only after renderer shows the browser tab and calls setVisible(true). */
  private visible = false;
  private bounds: BrowserPanelBounds = { x: 0, y: 0, width: 0, height: 0 };
  private disposed = false;
  private cachedCodexServer: CodexMcpServerForConfigSync | undefined;
  /** Renderer should open the browser task tab (shared session needs a display surface). */
  private panelRevealRequested = false;

  constructor(private readonly deps: BrowserHostDeps) {}

  getState(): BrowserViewState {
    const settings = this.deps.getSettings().get();
    const resolved = resolveAgentBrowserBinary();
    const wc = this.view?.webContents;
    return {
      url: wc && !wc.isDestroyed() ? wc.getURL() || HOME_URL : HOME_URL,
      title: wc && !wc.isDestroyed() ? wc.getTitle() || "" : "",
      canGoBack: Boolean(
        wc &&
          !wc.isDestroyed() &&
          (wc.navigationHistory?.canGoBack?.() ?? (typeof wc.canGoBack === "function" ? wc.canGoBack() : false)),
      ),
      canGoForward: Boolean(
        wc &&
          !wc.isDestroyed() &&
          (wc.navigationHistory?.canGoForward?.() ??
            (typeof wc.canGoForward === "function" ? wc.canGoForward() : false)),
      ),
      isLoading: Boolean(wc && !wc.isDestroyed() && wc.isLoading()),
      visible: this.visible,
      ...(this.cdp ? { cdpPort: this.cdp.port } : {}),
      agentIntegrationEnabled: settings.agentIntegrationEnabled,
      agentBrowserAvailable: resolved.available,
      ...(resolved.reason ? { agentBrowserUnavailableReason: resolved.reason } : {}),
      ...(this.panelRevealRequested ? { panelRevealRequested: true } : {}),
    };
  }

  getCachedCodexMcpServer(): CodexMcpServerForConfigSync | undefined {
    if (!this.deps.getSettings().get().agentIntegrationEnabled) {
      return undefined;
    }
    return this.cachedCodexServer;
  }

  clearCachedCodexMcpServer(): void {
    this.cachedCodexServer = undefined;
  }

  private emit(): void {
    if (this.disposed) return;
    this.deps.broadcast(this.getState());
  }

  /**
   * Prepare the shared guest. When Agent integration is ON, also ready CDP so agents
   * attach to whatever the human has open (and vice versa after agent navigates).
   */
  private warmAgentBridge(): void {
    if (!this.deps.getSettings().get().agentIntegrationEnabled) {
      return;
    }
    void this.ensureCdpPort().catch((error) => {
      process.stderr.write(
        `[eco-browser] CDP warm failed: ${error instanceof Error ? error.message : String(error)}\n`,
      );
    });
  }

  private requestPanelRevealIfHidden(): void {
    if (!this.visible) {
      this.panelRevealRequested = true;
    }
  }

  private ensureView(): WebContentsView {
    if (this.view && !this.view.webContents.isDestroyed()) {
      return this.view;
    }
    const win = this.deps.getMainWindow();
    if (!win || win.isDestroyed()) {
      throw new Error("主窗口不可用，无法创建内置浏览器。");
    }

    const guestSession = session.fromPartition(PARTITION);
    guestSession.setPermissionRequestHandler((_wc, _permission, callback) => {
      callback(false);
    });

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
        this.requestPanelRevealIfHidden();
        void view.webContents.loadURL(url);
      }
      return { action: "deny" };
    });

    const onNav = (_event: unknown, url?: string) => {
      const target =
        typeof url === "string" && url.trim()
          ? url
          : !view.webContents.isDestroyed()
            ? view.webContents.getURL()
            : "";
      // Human closed the tab but Agent/CDP still drove the guest → reopen the shared panel.
      if (isBrowserHttpUrl(target)) {
        this.requestPanelRevealIfHidden();
      }
      this.emit();
    };
    view.webContents.on("did-start-loading", () => this.emit());
    view.webContents.on("did-stop-loading", () => this.emit());
    view.webContents.on("did-navigate", onNav);
    view.webContents.on("did-navigate-in-page", onNav);
    view.webContents.on("page-title-updated", () => this.emit());
    view.webContents.on("did-fail-load", () => this.emit());

    win.contentView.addChildView(view);
    this.view = view;
    this.applyBounds();
    // Ensure a real document exists so CDP Page.navigate from agent-browser can attach.
    void view.webContents.loadURL(HOME_URL);
    return view;
  }

  /**
   * Single entry for human IPC and host-side open paths.
   * Guest + optional navigate + UI reveal request + Agent CDP warm (one shared session).
   */
  async openSharedSession(options: SharedBrowserOpenOptions = {}): Promise<BrowserViewState> {
    const revealUi = options.revealUi !== false;
    this.ensureView();
    if (revealUi) {
      this.requestPanelRevealIfHidden();
    }

    const raw = options.url?.trim();
    if (raw !== undefined && raw.length > 0) {
      const url = normalizeBrowserNavigateUrl(raw) ?? (raw === HOME_URL || raw === "about:blank" ? HOME_URL : undefined);
      if (!url) {
        throw new Error("无效的 URL");
      }
      const view = this.ensureView();
      // Keep the guest alive while hidden so human and agent share history/cookies.
      await view.webContents.loadURL(url);
    }

    this.warmAgentBridge();
    if (this.visible) {
      this.applyBounds();
    }
    this.emit();
    return this.getState();
  }

  setVisible(visible: boolean): BrowserViewState {
    this.visible = visible;
    if (!visible) {
      // Hide surface only — do not dispose guest/CDP (shared session stays for Agent).
      if (this.view && !this.view.webContents.isDestroyed()) {
        this.view.setVisible(false);
        this.view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
      }
    } else {
      this.panelRevealRequested = false;
      this.ensureView();
      this.applyBounds();
      // Human opened the panel → make sure Agent can attach to the same guest.
      this.warmAgentBridge();
    }
    this.emit();
    return this.getState();
  }

  setBounds(bounds: BrowserPanelBounds): BrowserViewState {
    this.bounds = {
      x: Math.max(0, Math.round(bounds.x)),
      y: Math.max(0, Math.round(bounds.y)),
      width: Math.max(0, Math.round(bounds.width)),
      height: Math.max(0, Math.round(bounds.height)),
    };
    if (this.visible) {
      this.ensureView();
      this.applyBounds();
    }
    return this.getState();
  }

  private applyBounds(): void {
    if (!this.view || this.view.webContents.isDestroyed()) return;
    if (!this.visible || this.bounds.width < 1 || this.bounds.height < 1) {
      this.view.setVisible(false);
      this.view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
      return;
    }
    this.view.setVisible(true);
    this.view.setBounds(this.bounds);
  }

  /** @deprecated Prefer openSharedSession — kept as thin alias for existing callers. */
  async navigate(rawUrl: string, options?: { reveal?: boolean }): Promise<BrowserViewState> {
    return this.openSharedSession({
      url: rawUrl,
      revealUi: options?.reveal !== false,
    });
  }

  goBack(): BrowserViewState {
    const view = this.ensureView();
    const wc = view.webContents;
    if (wc.navigationHistory?.canGoBack?.()) {
      wc.navigationHistory.goBack();
    } else if (typeof wc.canGoBack === "function" && wc.canGoBack()) {
      wc.goBack();
    }
    this.warmAgentBridge();
    this.emit();
    return this.getState();
  }

  goForward(): BrowserViewState {
    const view = this.ensureView();
    const wc = view.webContents;
    if (wc.navigationHistory?.canGoForward?.()) {
      wc.navigationHistory.goForward();
    } else if (typeof wc.canGoForward === "function" && wc.canGoForward()) {
      wc.goForward();
    }
    this.warmAgentBridge();
    this.emit();
    return this.getState();
  }

  reload(): BrowserViewState {
    const view = this.ensureView();
    view.webContents.reload();
    this.warmAgentBridge();
    this.emit();
    return this.getState();
  }

  async openExternalCurrent(): Promise<void> {
    const state = this.getState();
    if (isBrowserHttpUrl(state.url)) {
      await shell.openExternal(state.url);
    }
  }

  /**
   * Agent issued agent_browser_open. Eco owns the shared guest:
   * 1) reveal task-panel browser tab
   * 2) navigate the same WebContentsView when we have a URL
   * (agent-browser MCP should attach via CDP to this guest — not a second Chrome.)
   */
  async notifyAgentBrowserOpen(url?: string): Promise<BrowserViewState> {
    return this.openSharedSession({
      ...(url ? { url } : {}),
      revealUi: true,
    });
  }

  /**
   * Ensure guest + CDP proxy (ephemeral port, never 9222).
   * Does **not** open the human panel — that stays until agent_browser_open
   * (Page.navigate / tool.started) or human open / guest http navigate. Session prep must stay silent.
   */
  async ensureCdpPort(): Promise<number> {
    if (this.cdp) {
      return this.cdp.port;
    }
    if (this.cdpStarting) {
      return this.cdpStarting;
    }
    this.cdpStarting = (async () => {
      this.ensureView();
      const view = this.view!;
      const proxy = await startBrowserCdpProxy(view.webContents, {
        onClientActivity: (detail) => {
          if (!shouldRevealBrowserForCdpActivity(detail)) {
            return;
          }
          this.requestPanelRevealIfHidden();
          this.emit();
        },
      });
      this.cdp = proxy;
      this.emit();
      return proxy.port;
    })();
    try {
      return await this.cdpStarting;
    } finally {
      this.cdpStarting = undefined;
    }
  }

  getAgentPromptAppend(): string | undefined {
    const settings = this.deps.getSettings().get();
    if (!settings.agentIntegrationEnabled) {
      return undefined;
    }
    return ECO_AGENT_BROWSER_PROMPT_APPEND;
  }

  async resolveAgentBrowserMcpInjection(): Promise<AgentBrowserMcpInjection> {
    const settings = this.deps.getSettings().get();
    if (!settings.agentIntegrationEnabled) {
      this.cachedCodexServer = undefined;
      return { enabled: false, serverName: ECO_AGENT_BROWSER_MCP_SERVER };
    }
    const resolved = resolveAgentBrowserBinary();
    if (!resolved.available || !resolved.binaryPath) {
      this.cachedCodexServer = undefined;
      return {
        enabled: false,
        serverName: ECO_AGENT_BROWSER_MCP_SERVER,
        unavailableReason: resolved.reason ?? "agent-browser 不可用",
      };
    }
    let cdpPort: number;
    try {
      // Attaches to the human/agent shared guest (creates if needed).
      cdpPort = await this.ensureCdpPort();
    } catch (error) {
      this.cachedCodexServer = undefined;
      return {
        enabled: false,
        serverName: ECO_AGENT_BROWSER_MCP_SERVER,
        unavailableReason: error instanceof Error ? error.message : String(error),
      };
    }
    const args = buildAgentBrowserMcpArgs(cdpPort);
    const runtimeEnv = ensureAgentBrowserRuntimeEnv(cdpPort);
    const sdkEntry = {
      type: "stdio" as const,
      command: resolved.binaryPath,
      args,
      env: runtimeEnv,
      alwaysLoad: true,
    };
    const codexServer: CodexMcpServerForConfigSync = {
      name: ECO_AGENT_BROWSER_MCP_SERVER,
      transport: "stdio",
      command: resolved.binaryPath,
      args,
      env: runtimeEnv,
      startupTimeoutSec: 60,
    };
    this.cachedCodexServer = codexServer;
    return {
      enabled: true,
      serverName: ECO_AGENT_BROWSER_MCP_SERVER,
      sdkEntry,
      codexServer,
      allowedToolPattern: ECO_AGENT_BROWSER_ALLOWED_TOOL,
      promptAppend: ECO_AGENT_BROWSER_PROMPT_APPEND,
    };
  }

  mergeIntoSdkMcpConfig(base: McpSdkConfig, injection: AgentBrowserMcpInjection): McpSdkConfig {
    if (!injection.enabled || !injection.sdkEntry) {
      return base;
    }
    return {
      mcpServers: {
        ...base.mcpServers,
        [ECO_AGENT_BROWSER_MCP_SERVER]: injection.sdkEntry,
      },
      allowedTools: [...new Set([...base.allowedTools, ECO_AGENT_BROWSER_ALLOWED_TOOL])],
    };
  }

  dispose(): void {
    this.disposed = true;
    this.cachedCodexServer = undefined;
    this.panelRevealRequested = false;
    void this.cdp?.close();
    this.cdp = undefined;
    if (this.view) {
      const win = this.deps.getMainWindow();
      try {
        if (win && !win.isDestroyed()) {
          win.contentView.removeChildView(this.view);
        }
      } catch {
        // ignore
      }
      try {
        if (!this.view.webContents.isDestroyed()) {
          this.view.webContents.close();
        }
      } catch {
        // ignore
      }
      this.view = undefined;
    }
  }
}

export function isWebContentsAlive(wc: WebContents | undefined): wc is WebContents {
  return Boolean(wc && !wc.isDestroyed());
}
