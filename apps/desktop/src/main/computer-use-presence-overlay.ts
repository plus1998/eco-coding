import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BrowserWindow, screen } from "electron";
import {
  COMPUTER_USE_AGENT_PRESENCE_IDLE_MS,
  type ComputerUseAgentPresenceEvent,
  parseComputerUsePointerFromToolInput,
} from "../shared/computer-use-agent-presence";
import { logEcoDiag } from "./eco-diag-log";

function resolveOverlayHtmlPath(): string {
  const candidates = [
    path.join(path.dirname(fileURLToPath(import.meta.url)), "../../packaging/computer-use-presence-overlay.html"),
    path.join(process.cwd(), "apps/desktop/packaging/computer-use-presence-overlay.html"),
    path.join(process.cwd(), "packaging/computer-use-presence-overlay.html"),
  ];
  try {
    if (typeof process.resourcesPath === "string" && process.resourcesPath) {
      candidates.unshift(path.join(process.resourcesPath, "computer-use-presence-overlay.html"));
      candidates.unshift(path.join(process.resourcesPath, "packaging", "computer-use-presence-overlay.html"));
    }
  } catch {
    // ignore
  }
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return candidates[0]!;
}

type OverlaySurface = {
  displayId: number;
  bounds: Electron.Rectangle;
  window: BrowserWindow;
  ready: boolean;
};

/**
 * OS-level transparent always-on-top overlays (rainbow edge + synthetic cursor)
 * while eco_computer_use tools run. Click-through so the real desktop stays operable.
 *
 * Gap: upstream click/drag x/y are often app-window / screenshot pixels. When we
 * only have those, we map them onto the display that contains the current cursor
 * (or primary) as a best-effort visual — not guaranteed pixel-accurate.
 */
export class ComputerUsePresenceOverlayHost {
  private surfaces = new Map<number, OverlaySurface>();
  private idleTimer: ReturnType<typeof setTimeout> | undefined;
  private activeScopeId: string | undefined;
  private disposed = false;
  private displayListenerAttached = false;
  private ensurePromise: Promise<void> | undefined;
  private pendingEvents: ComputerUseAgentPresenceEvent[] = [];

  noteToolActivity(input: {
    threadId: string;
    toolName?: string;
    toolInput?: Record<string, unknown>;
  }): void {
    if (this.disposed) return;
    const scopeId = input.threadId.trim() || "global";
    const pointer = parseComputerUsePointerFromToolInput(input.toolInput);
    const events: ComputerUseAgentPresenceEvent[] = [];
    if (pointer) {
      if (pointer.kind === "drag") {
        const start = this.mapApproximatePointerToScreen(pointer.x, pointer.y);
        const end = this.mapApproximatePointerToScreen(pointer.endX, pointer.endY);
        events.push({ type: "active", scopeId, at: Date.now() });
        events.push({
          type: "move",
          scopeId,
          x: start.x,
          y: start.y,
          dragging: true,
          at: Date.now(),
        });
        events.push({
          type: "release",
          scopeId,
          x: end.x,
          y: end.y,
          at: Date.now(),
        });
      } else if (pointer.kind === "move") {
        const mapped = this.mapApproximatePointerToScreen(pointer.x, pointer.y);
        events.push({ type: "active", scopeId, at: Date.now() });
        events.push({
          type: "move",
          scopeId,
          x: mapped.x,
          y: mapped.y,
          dragging: false,
          at: Date.now(),
        });
      } else {
        const mapped = this.mapApproximatePointerToScreen(pointer.x, pointer.y);
        events.push({ type: "active", scopeId, at: Date.now() });
        events.push({
          type: "click",
          scopeId,
          x: mapped.x,
          y: mapped.y,
          at: Date.now(),
        });
      }
    } else {
      const point = screen.getCursorScreenPoint();
      events.push({ type: "active", scopeId, at: Date.now() });
      events.push({
        type: "move",
        scopeId,
        x: point.x,
        y: point.y,
        dragging: false,
        at: Date.now(),
      });
    }
    this.activeScopeId = scopeId;
    this.scheduleIdle(scopeId);
    logEcoDiag("computer_use.presence", {
      scopeId,
      toolName: input.toolName ?? "",
      eventCount: events.length,
      hasPointer: Boolean(pointer),
    });
    void this.dispatchEvents(events);
  }

  /** Dev / settings preview: force-show overlay without a tool call. */
  preview(): void {
    if (this.disposed) return;
    // Rebuild surfaces so packaging HTML edits apply without full app restart.
    for (const surface of this.surfaces.values()) {
      if (!surface.window.isDestroyed()) {
        surface.window.destroy();
      }
    }
    this.surfaces.clear();
    this.ensurePromise = undefined;
    this.pendingEvents = [];
    const scopeId = "preview";
    const point = screen.getCursorScreenPoint();
    this.activeScopeId = scopeId;
    this.scheduleIdle(scopeId);
    void this.dispatchEvents([
      { type: "active", scopeId, at: Date.now() },
      {
        type: "click",
        scopeId,
        x: point.x,
        y: point.y,
        at: Date.now(),
      },
    ]);
  }

  forceIdle(): void {
    if (this.activeScopeId) {
      void this.dispatchEvents([{ type: "idle", scopeId: this.activeScopeId, at: Date.now() }]);
    }
    this.activeScopeId = undefined;
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = undefined;
    }
  }

  async close(): Promise<void> {
    this.disposed = true;
    this.forceIdle();
    if (this.displayListenerAttached) {
      screen.removeListener("display-added", this.onDisplaysChanged);
      screen.removeListener("display-removed", this.onDisplaysChanged);
      screen.removeListener("display-metrics-changed", this.onDisplaysChanged);
      this.displayListenerAttached = false;
    }
    for (const surface of this.surfaces.values()) {
      if (!surface.window.isDestroyed()) {
        surface.window.destroy();
      }
    }
    this.surfaces.clear();
    this.pendingEvents = [];
    this.ensurePromise = undefined;
  }

  private onDisplaysChanged = (): void => {
    if (this.disposed) return;
    this.ensurePromise = undefined;
    void this.rebuildSurfaces();
  };

  private async dispatchEvents(events: ComputerUseAgentPresenceEvent[]): Promise<void> {
    this.pendingEvents.push(...events);
    try {
      await this.ensureSurfaces();
    } catch (error) {
      logEcoDiag("computer_use.presence_error", {
        message: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    if (this.disposed) return;
    const ready = [...this.surfaces.values()].some((s) => s.ready && !s.window.isDestroyed());
    if (!ready) {
      // Surfaces created but not ready yet — flush happens on did-finish-load.
      return;
    }
    this.flushPending();
  }

  private flushPending(): void {
    if (this.pendingEvents.length === 0) return;
    const batch = this.pendingEvents.splice(0, this.pendingEvents.length);
    for (const event of batch) {
      this.emitNow(event);
    }
  }

  private async ensureSurfaces(): Promise<void> {
    if (this.surfaces.size > 0) {
      let healthy = false;
      for (const surface of this.surfaces.values()) {
        if (surface.window.isDestroyed()) continue;
        healthy = true;
        if (!surface.window.isVisible()) {
          surface.window.showInactive();
        }
      }
      if (healthy) return;
    }
    if (!this.ensurePromise) {
      this.ensurePromise = this.rebuildSurfaces().finally(() => {
        this.ensurePromise = undefined;
      });
    }
    await this.ensurePromise;
  }

  private async rebuildSurfaces(): Promise<void> {
    const htmlPath = resolveOverlayHtmlPath();
    if (!fs.existsSync(htmlPath)) {
      throw new Error(`Computer Use presence overlay HTML missing: ${htmlPath}`);
    }
    logEcoDiag("computer_use.presence_html", { htmlPath });

    for (const surface of this.surfaces.values()) {
      if (!surface.window.isDestroyed()) {
        surface.window.destroy();
      }
    }
    this.surfaces.clear();

    if (!this.displayListenerAttached) {
      screen.on("display-added", this.onDisplaysChanged);
      screen.on("display-removed", this.onDisplaysChanged);
      screen.on("display-metrics-changed", this.onDisplaysChanged);
      this.displayListenerAttached = true;
    }

    const loadWaiters: Promise<void>[] = [];

    for (const display of screen.getAllDisplays()) {
      const bounds = display.bounds;
      // Windows: exact monitor-sized transparent windows often composite as opaque
      // black/white (Electron #30798). Shrink by 1px so DWM keeps true transparency.
      const width = Math.max(bounds.width - 1, 1);
      const height = Math.max(bounds.height - 1, 1);
      const win = new BrowserWindow({
        x: bounds.x,
        y: bounds.y,
        width,
        height,
        frame: false,
        transparent: true,
        resizable: false,
        movable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        skipTaskbar: true,
        focusable: false,
        hasShadow: false,
        show: false,
        alwaysOnTop: true,
        backgroundColor: "#00000000",
        // Windows: keep off the task switcher / avoid stealing focus.
        ...(process.platform === "win32" ? { type: "toolbar" as const } : {}),
        webPreferences: {
          nodeIntegration: true,
          contextIsolation: false,
          sandbox: false,
          backgroundThrottling: false,
        },
      });
      win.setIgnoreMouseEvents(true, { forward: true });
      win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      try {
        // pop-up-menu is more reliable than screen-saver on Windows for compositing.
        win.setAlwaysOnTop(true, process.platform === "win32" ? "pop-up-menu" : "screen-saver");
      } catch {
        win.setAlwaysOnTop(true);
      }
      try {
        win.setBackgroundColor("#00000000");
      } catch {
        // ignore
      }

      const surface: OverlaySurface = {
        displayId: display.id,
        bounds: { x: bounds.x, y: bounds.y, width, height },
        window: win,
        ready: false,
      };
      this.surfaces.set(display.id, surface);

      loadWaiters.push(
        new Promise<void>((resolve) => {
          const finish = () => {
            win.webContents.send("computer-use-presence:init", {
              originX: bounds.x,
              originY: bounds.y,
              width,
              height,
            });
            surface.ready = true;
            if (!win.isDestroyed()) {
              win.showInactive();
              try {
                win.moveTop();
              } catch {
                // ignore
              }
            }
            this.flushPending();
            resolve();
          };
          win.webContents.once("did-finish-load", finish);
          win.webContents.once("did-fail-load", (_e, code, desc) => {
            logEcoDiag("computer_use.presence_load_fail", { code, desc, htmlPath });
            resolve();
          });
        }),
      );

      await win.loadFile(htmlPath);
    }

    await Promise.all(loadWaiters);
    logEcoDiag("computer_use.presence_ready", { surfaces: this.surfaces.size });
  }

  private emitNow(event: ComputerUseAgentPresenceEvent): void {
    for (const surface of this.surfaces.values()) {
      if (surface.window.isDestroyed() || !surface.ready) continue;
      if (!surface.window.isVisible()) {
        surface.window.showInactive();
      }
      surface.window.webContents.send("computer-use-presence:event", event);
    }
  }

  private scheduleIdle(scopeId: string): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      this.idleTimer = undefined;
      if (this.disposed) return;
      void this.dispatchEvents([{ type: "idle", scopeId, at: Date.now() }]);
      if (this.activeScopeId === scopeId) {
        this.activeScopeId = undefined;
      }
      // Hide after a short delay so the idle fade can render.
      setTimeout(() => {
        if (this.activeScopeId) return;
        for (const surface of this.surfaces.values()) {
          if (!surface.window.isDestroyed()) {
            surface.window.hide();
          }
        }
      }, 220);
    }, COMPUTER_USE_AGENT_PRESENCE_IDLE_MS);
  }

  /**
   * Map tool-local x/y onto the display under the OS cursor (fallback: primary).
   * Not pixel-accurate for app-window screenshot coords — visual guidance only.
   */
  private mapApproximatePointerToScreen(x: number, y: number): { x: number; y: number } {
    const cursor = screen.getCursorScreenPoint();
    const display = screen.getDisplayNearestPoint(cursor) ?? screen.getPrimaryDisplay();
    const bounds = display.bounds;
    if (
      x >= bounds.x - 2 &&
      y >= bounds.y - 2 &&
      x <= bounds.x + bounds.width + 2 &&
      y <= bounds.y + bounds.height + 2
    ) {
      return { x, y };
    }
    const clampedX = Math.min(Math.max(x, 0), Math.max(bounds.width - 1, 0));
    const clampedY = Math.min(Math.max(y, 0), Math.max(bounds.height - 1, 0));
    return { x: bounds.x + clampedX, y: bounds.y + clampedY };
  }
}
