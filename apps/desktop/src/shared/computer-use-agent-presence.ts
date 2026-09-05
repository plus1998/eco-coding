/** How long after the last Computer Use action before the OS overlay clears. */
export const COMPUTER_USE_AGENT_PRESENCE_IDLE_MS = 15_000;

export type ComputerUseAgentPresenceEvent =
  | {
      type: "active";
      /** Logical presence id (usually threadId or "global"). */
      scopeId: string;
      at: number;
    }
  | {
      type: "click";
      scopeId: string;
      /** Screen DIP coordinates (Electron `screen` space). */
      x: number;
      y: number;
      at: number;
    }
  | {
      type: "move";
      scopeId: string;
      x: number;
      y: number;
      dragging: boolean;
      at: number;
    }
  | {
      type: "release";
      scopeId: string;
      x: number;
      y: number;
      at: number;
    }
  | {
      type: "idle";
      scopeId: string;
      at: number;
    };

export function isEcoComputerUseToolName(toolName: string | undefined): boolean {
  const name = toolName?.trim().toLowerCase() ?? "";
  if (!name) return false;
  return (
    name.includes("eco_computer_use") ||
    name.includes("eco-computer-use") ||
    name.includes("open_computer_use") ||
    name.includes("open-computer-use") ||
    name.includes("mcp__eco_computer_use") ||
    name.includes("mcp__eco-computer-use")
  );
}

/**
 * Best-effort parse of click/drag coordinates from Computer Use tool input.
 * Upstream x/y are often app-window / screenshot pixels — callers should treat
 * them as approximate when mapping to screen DIP (see presence host).
 */
export function parseComputerUsePointerFromToolInput(
  input: Record<string, unknown> | undefined,
):
  | { kind: "click"; x: number; y: number }
  | { kind: "drag"; x: number; y: number; endX: number; endY: number }
  | { kind: "move"; x: number; y: number }
  | undefined {
  if (!input) return undefined;

  const startX = Number(input.start_x ?? input.from_x ?? input.x);
  const startY = Number(input.start_y ?? input.from_y ?? input.y);
  const endX = Number(input.end_x ?? input.to_x);
  const endY = Number(input.end_y ?? input.to_y);

  if (Number.isFinite(startX) && Number.isFinite(startY) && Number.isFinite(endX) && Number.isFinite(endY)) {
    return { kind: "drag", x: startX, y: startY, endX, endY };
  }

  const x = Number(input.x);
  const y = Number(input.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    if (Number.isFinite(startX) && Number.isFinite(startY)) {
      return { kind: "move", x: startX, y: startY };
    }
    return undefined;
  }
  return { kind: "click", x, y };
}

/** Leaf tool names that typically mutate pointer position. */
export function isComputerUsePointerToolLeaf(toolName: string): boolean {
  const leaf = toolName.trim().toLowerCase().split("__").pop() ?? "";
  return (
    leaf === "click" ||
    leaf === "drag" ||
    leaf === "scroll" ||
    leaf === "perform_secondary_action"
  );
}
