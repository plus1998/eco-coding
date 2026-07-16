import { useEffect, useRef, useState } from "react";
import type { FitAddon, Ghostty, ITheme, Terminal as GhosttyTerminalType } from "ghostty-web";
import type { TerminalStreamEvent } from "../shared/ipc";
import {
  DEFAULT_TYPOGRAPHY_PREFERENCES,
  TYPOGRAPHY_CHANGE_EVENT,
  type TypographyPreferences,
} from "./typography-preferences";

interface GhosttyRuntime {
  mod: typeof import("ghostty-web");
  ghostty: Ghostty;
}

export interface TerminalDimensions {
  cols: number;
  rows: number;
}

let sharedGhostty: Promise<GhosttyRuntime> | undefined;

function loadGhosttyRuntime(): Promise<GhosttyRuntime> {
  if (!sharedGhostty) {
    sharedGhostty = import("ghostty-web")
      .then(async (mod) => ({ mod, ghostty: await mod.Ghostty.load() }))
      .catch((error) => {
        sharedGhostty = undefined;
        throw error;
      });
  }
  return sharedGhostty;
}

function readCssVar(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

function readTerminalFontSize(): number {
  const value = Number.parseFloat(
    readCssVar("--code-font-size", String(DEFAULT_TYPOGRAPHY_PREFERENCES.codeFontSize)),
  );
  return Number.isFinite(value) ? value : DEFAULT_TYPOGRAPHY_PREFERENCES.codeFontSize;
}

function readTerminalTheme(): ITheme {
  const isLight = document.documentElement.dataset.theme === "light";
  const background = readCssVar("--terminal-bg", isLight ? "#f7f7f8" : "#171717");
  const foreground = readCssVar("--terminal-fg", isLight ? "#1d1d1f" : "#f2f2f2");
  const selectionBackground = readCssVar(
    "--terminal-selection-bg",
    isLight ? "rgba(0, 122, 255, 0.22)" : "rgba(59, 130, 246, 0.35)",
  );

  if (isLight) {
    return {
      background,
      foreground,
      cursor: readCssVar("--terminal-cursor", foreground),
      cursorAccent: background,
      selectionBackground,
      selectionForeground: foreground,
      black: "#1d1d1f",
      red: "#d70015",
      green: "#248a3d",
      yellow: "#b25000",
      blue: "#0040dd",
      magenta: "#8944ab",
      cyan: "#007787",
      white: "#6e6e73",
      brightBlack: "#6e6e73",
      brightRed: "#ff3b30",
      brightGreen: "#34c759",
      brightYellow: "#ff9500",
      brightBlue: "#007aff",
      brightMagenta: "#af52de",
      brightCyan: "#32ade6",
      brightWhite: "#1d1d1f",
    };
  }

  return {
    background,
    foreground,
    cursor: readCssVar("--terminal-cursor", foreground),
    cursorAccent: background,
    selectionBackground,
    selectionForeground: foreground,
    black: "#1d1d1f",
    red: "#ff453a",
    green: "#32d74b",
    yellow: "#ffd60a",
    blue: "#0a84ff",
    magenta: "#bf5af2",
    cyan: "#64d2ff",
    white: "#f2f2f2",
    brightBlack: "#8e8e93",
    brightRed: "#ff6961",
    brightGreen: "#30db5b",
    brightYellow: "#ffd426",
    brightBlue: "#409cff",
    brightMagenta: "#da8fff",
    brightCyan: "#70d7ff",
    brightWhite: "#ffffff",
  };
}

function applyTerminalTheme(terminal: GhosttyTerminalType): void {
  terminal.options.theme = readTerminalTheme();
}

function isToggleTerminalShortcut(event: KeyboardEvent): boolean {
  const key = event.key;
  if (key !== "`" && key !== "~") {
    return false;
  }
  return event.ctrlKey || event.metaKey;
}

function mountHasLayout(element: HTMLElement): boolean {
  return element.clientWidth > 0 && element.clientHeight > 0;
}

async function fitWhenLayoutReady(
  mount: HTMLElement,
  fit: FitAddon,
  terminal: GhosttyTerminalType,
): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    fit.fit();
    if (mountHasLayout(mount) && terminal.cols > 0 && terminal.rows > 0) {
      return;
    }
    await new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => resolve());
    });
  }
  fit.fit();
}

interface GhosttyTerminalProps {
  sessionId: string | null;
  active?: boolean;
  onDimensionsReady?: (dimensions: TerminalDimensions) => void;
  onExit?: (exitCode: number) => void;
}

export function GhosttyTerminal({
  sessionId,
  active = true,
  onDimensionsReady,
  onExit,
}: GhosttyTerminalProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const sessionIdRef = useRef(sessionId);
  const activeRef = useRef(active);
  const onDimensionsReadyRef = useRef(onDimensionsReady);
  const onExitRef = useRef(onExit);
  const termRef = useRef<GhosttyTerminalType | undefined>(undefined);
  const fitRef = useRef<FitAddon | undefined>(undefined);
  const dimensionsReadyRef = useRef(false);
  const initialResizeSyncedRef = useRef(false);
  const [terminalEpoch, setTerminalEpoch] = useState(0);

  sessionIdRef.current = sessionId;
  activeRef.current = active;
  onDimensionsReadyRef.current = onDimensionsReady;
  onExitRef.current = onExit;

  useEffect(() => {
    if (sessionId) {
      return;
    }
    dimensionsReadyRef.current = false;
    initialResizeSyncedRef.current = false;
    const terminal = termRef.current;
    if (!terminal || terminal.cols <= 0 || terminal.rows <= 0) {
      return;
    }
    dimensionsReadyRef.current = true;
    onDimensionsReadyRef.current?.({
      cols: terminal.cols,
      rows: terminal.rows,
    });
  }, [sessionId]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount || !window.eco) {
      return undefined;
    }

    let disposed = false;
    let resizeTimer: number | undefined;
    let fitFrame: number | undefined;
    const cleanups: Array<() => void> = [];

    const notifyDimensionsReady = (terminal: GhosttyTerminalType) => {
      if (dimensionsReadyRef.current || sessionIdRef.current) {
        return;
      }
      if (terminal.cols <= 0 || terminal.rows <= 0) {
        return;
      }
      dimensionsReadyRef.current = true;
      onDimensionsReadyRef.current?.({
        cols: terminal.cols,
        rows: terminal.rows,
      });
    };

    const syncPtySize = (cols: number, rows: number, immediate = false) => {
      if (!sessionIdRef.current || !window.eco) {
        return;
      }
      if (immediate) {
        void window.eco
          .resizeTerminal({ sessionId: sessionIdRef.current, cols, rows })
          .catch(() => undefined);
        return;
      }
      if (resizeTimer !== undefined) {
        window.clearTimeout(resizeTimer);
      }
      resizeTimer = window.setTimeout(() => {
        resizeTimer = undefined;
        if (disposed || !sessionIdRef.current || !window.eco) {
          return;
        }
        void window.eco
          .resizeTerminal({ sessionId: sessionIdRef.current, cols, rows })
          .catch(() => undefined);
      }, 100);
    };

    const run = async () => {
      const { mod, ghostty } = await loadGhosttyRuntime();
      if (disposed) {
        return;
      }

      const terminal = new mod.Terminal({
        ghostty,
        cursorBlink: true,
        scrollback: 10_000,
        fontSize: readTerminalFontSize(),
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
        theme: readTerminalTheme(),
      });
      termRef.current = terminal;

      const fit = new mod.FitAddon();
      fitRef.current = fit;
      terminal.loadAddon(fit);

      terminal.attachCustomKeyEventHandler((event) => {
        if (isToggleTerminalShortcut(event)) {
          return true;
        }
        if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "c") {
          document.execCommand("copy");
          return true;
        }
        return false;
      });

      terminal.open(mount);

      const themeObserver = new MutationObserver(() => {
        if (!disposed && termRef.current) {
          applyTerminalTheme(termRef.current);
        }
      });
      themeObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["data-theme"],
      });
      cleanups.push(() => themeObserver.disconnect());

      const scheduleFit = () => {
        if (disposed || !fitRef.current) {
          return;
        }
        if (fitFrame !== undefined) {
          return;
        }
        fitFrame = window.requestAnimationFrame(() => {
          fitFrame = undefined;
          if (disposed || !fitRef.current || !termRef.current) {
            return;
          }
          fitRef.current.fit();
        });
      };

      const onResize = terminal.onResize(({ cols, rows }) => {
        const immediate = !initialResizeSyncedRef.current;
        if (immediate) {
          initialResizeSyncedRef.current = true;
        }
        syncPtySize(cols, rows, immediate);
      });
      cleanups.push(() => onResize.dispose());

      const handleWindowResize = () => scheduleFit();
      window.addEventListener("resize", handleWindowResize);
      cleanups.push(() => window.removeEventListener("resize", handleWindowResize));

      const handleTypographyChange = (event: Event) => {
        const preferences = (event as CustomEvent<TypographyPreferences>).detail;
        if (!preferences || disposed || !termRef.current) {
          return;
        }
        termRef.current.options.fontSize = preferences.codeFontSize;
        scheduleFit();
      };
      window.addEventListener(TYPOGRAPHY_CHANGE_EVENT, handleTypographyChange);
      cleanups.push(() => window.removeEventListener(TYPOGRAPHY_CHANGE_EVENT, handleTypographyChange));

      if (document.fonts) {
        await document.fonts.ready;
      }
      if (disposed) {
        return;
      }

      await fitWhenLayoutReady(mount, fit, terminal);
      if (disposed) {
        return;
      }

      notifyDimensionsReady(terminal);
      if (sessionIdRef.current) {
        syncPtySize(terminal.cols, terminal.rows, true);
      }

      fit.observeResize();
      cleanups.push(() => fit.dispose());

      if (activeRef.current) {
        terminal.focus();
      }

      setTerminalEpoch((epoch) => epoch + 1);
    };

    void run().catch((error) => {
      if (disposed || !mount) {
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      mount.textContent = `终端初始化失败：${message}`;
      mount.style.color = "var(--terminal-fg, var(--text-primary))";
    });

    return () => {
      disposed = true;
      if (fitFrame !== undefined) {
        window.cancelAnimationFrame(fitFrame);
      }
      if (resizeTimer !== undefined) {
        window.clearTimeout(resizeTimer);
      }
      for (const cleanup of cleanups.reverse()) {
        cleanup();
      }
      termRef.current?.dispose();
      termRef.current = undefined;
      fitRef.current = undefined;
    };
  }, []);

  useEffect(() => {
    const terminal = termRef.current;
    const eco = window.eco;
    if (!terminal || !sessionId || !eco) {
      return undefined;
    }

    terminal.clear();
    initialResizeSyncedRef.current = false;
    void eco.resizeTerminal({ sessionId, cols: terminal.cols, rows: terminal.rows }).catch(() => undefined);
    initialResizeSyncedRef.current = true;

    const onData = terminal.onData((data) => {
      void eco.writeTerminalInput({ sessionId, data }).catch(() => undefined);
    });

    const unsubscribe = eco.onTerminalEvent((event: TerminalStreamEvent) => {
      if (event.sessionId !== sessionId) {
        return;
      }
      if (event.type === "output") {
        terminal.write(event.data);
        return;
      }
      if (event.type === "error") {
        terminal.writeln(`\r\n\x1b[31m${event.message}\x1b[0m`);
        return;
      }
      if (event.type === "exit") {
        onExitRef.current?.(event.exitCode);
      }
    });

    return () => {
      onData.dispose();
      unsubscribe();
    };
  }, [sessionId, terminalEpoch]);

  useEffect(() => {
    const terminal = termRef.current;
    const mount = mountRef.current;
    if (!terminal || !mount) {
      return undefined;
    }
    if (!active) {
      terminal.blur();
      return undefined;
    }
    const frame = window.requestAnimationFrame(() => {
      fitRef.current?.fit();
    });
    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) {
        return;
      }
      terminal.focus();
    };
    mount.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.cancelAnimationFrame(frame);
      mount.removeEventListener("pointerdown", onPointerDown);
    };
  }, [active]);

  return (
    <div className="ghostty-terminal-host" data-component="terminal">
      <div ref={mountRef} className="ghostty-terminal-mount" />
    </div>
  );
}
