import { describe, expect, test } from "bun:test";
import {
  BROWSER_AGENT_PRESENCE_IDLE_MS,
  BROWSER_AGENT_PRESENCE_MOVE_THROTTLE_MS,
  isBrowserAgentPresenceCdpMethod,
  isBrowserAgentPresenceClickType,
  isBrowserAgentPresencePointerType,
  parseBrowserAgentPresenceMouse,
} from "../src/shared/browser-agent-presence";

describe("browser-agent-presence", () => {
  test("idle timeout is 15 seconds", () => {
    expect(BROWSER_AGENT_PRESENCE_IDLE_MS).toBe(15_000);
  });

  test("move throttle keeps drag IPC light", () => {
    expect(BROWSER_AGENT_PRESENCE_MOVE_THROTTLE_MS).toBe(32);
  });

  test("parseBrowserAgentPresenceMouse reads CDP coords and buttons", () => {
    expect(
      parseBrowserAgentPresenceMouse({ type: "mousePressed", x: 120.5, y: 40, buttons: 1 }),
    ).toEqual({ x: 120.5, y: 40, type: "mousePressed", buttons: 1 });
    expect(
      parseBrowserAgentPresenceMouse({ type: "mouseMoved", x: 10, y: 20, buttons: 1 }),
    ).toEqual({ x: 10, y: 20, type: "mouseMoved", buttons: 1 });
    expect(parseBrowserAgentPresenceMouse({ type: "mouseMoved" })).toBeNull();
    expect(parseBrowserAgentPresenceMouse(undefined)).toBeNull();
  });

  test("pointer types include drag moves", () => {
    expect(isBrowserAgentPresenceClickType("mousePressed")).toBe(true);
    expect(isBrowserAgentPresenceClickType("mouseReleased")).toBe(true);
    expect(isBrowserAgentPresenceClickType("mouseMoved")).toBe(false);
    expect(isBrowserAgentPresencePointerType("mouseMoved")).toBe(true);
    expect(isBrowserAgentPresencePointerType("mousePressed")).toBe(true);
  });

  test("presence CDP methods cover input and navigation", () => {
    expect(isBrowserAgentPresenceCdpMethod("Input.dispatchMouseEvent")).toBe(true);
    expect(isBrowserAgentPresenceCdpMethod("Input.insertText")).toBe(true);
    expect(isBrowserAgentPresenceCdpMethod("Page.navigate")).toBe(true);
    expect(isBrowserAgentPresenceCdpMethod("Network.enable")).toBe(false);
  });
});
