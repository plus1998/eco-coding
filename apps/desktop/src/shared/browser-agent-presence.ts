/** How long after the last Agent browser action before the presence overlay clears. */
export const BROWSER_AGENT_PRESENCE_IDLE_MS = 15_000;

/** Throttle CDP mouseMoved → pointer IPC so drag trails stay smooth without flooding. */
export const BROWSER_AGENT_PRESENCE_MOVE_THROTTLE_MS = 32;

export type BrowserAgentPresenceEvent =
  | {
      type: "active";
      browserId: string;
      at: number;
    }
  | {
      type: "click";
      browserId: string;
      x: number;
      y: number;
      at: number;
    }
  | {
      /** Pointer moved — used for drag trails and hover tracking. */
      type: "move";
      browserId: string;
      x: number;
      y: number;
      dragging: boolean;
      at: number;
    }
  | {
      type: "release";
      browserId: string;
      x: number;
      y: number;
      at: number;
    }
  | {
      type: "idle";
      browserId: string;
      at: number;
    };

/** CDP Input.dispatchMouseEvent types that should drive the synthetic pointer. */
export function isBrowserAgentPresenceClickType(type: string): boolean {
  return type === "mousePressed" || type === "mouseReleased";
}

export function isBrowserAgentPresencePointerType(type: string): boolean {
  return type === "mousePressed" || type === "mouseReleased" || type === "mouseMoved";
}

/**
 * Extract viewport CSS-pixel click coords from a CDP Input.dispatchMouseEvent payload.
 * Returns null when coordinates are missing/invalid.
 */
export function parseBrowserAgentPresenceMouse(
  params: Record<string, unknown> | undefined,
): { x: number; y: number; type: string; buttons: number } | null {
  if (!params) {
    return null;
  }
  const x = Number(params.x);
  const y = Number(params.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }
  const type = typeof params.type === "string" ? params.type : "";
  const buttons = Number(params.buttons ?? 0);
  return { x, y, type, buttons: Number.isFinite(buttons) ? buttons : 0 };
}

/** Methods that count as Agent operating the page (refresh idle timer). */
export function isBrowserAgentPresenceCdpMethod(method: string): boolean {
  return (
    method.startsWith("Input.") ||
    method === "Page.navigate" ||
    method === "Page.navigateToHistoryEntry" ||
    method === "Page.reload" ||
    method === "DOM.focus" ||
    method === "Runtime.evaluate" ||
    method === "Target.activateTarget" ||
    method === "Target.createTarget"
  );
}
