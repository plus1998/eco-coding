import { expect, test } from "bun:test";
import {
  extractUrlFromBrowserOpenToolPayload,
  isEcoAgentBrowserOpenToolName,
  shouldRevealBrowserForCdpActivity,
} from "../src/shared/browser";

test("MCP/CDP handshake and non-open tools do not reveal browser panel", () => {
  expect(shouldRevealBrowserForCdpActivity({ kind: "ws-connect" })).toBe(false);
  expect(shouldRevealBrowserForCdpActivity({ kind: "cdp-method", method: "Page.enable" })).toBe(
    false,
  );
  expect(shouldRevealBrowserForCdpActivity({ kind: "cdp-method", method: "Runtime.evaluate" })).toBe(
    false,
  );
  expect(shouldRevealBrowserForCdpActivity({ kind: "cdp-method", method: "Target.getTargets" })).toBe(
    false,
  );
  // snapshot / click / screenshot are not agent_browser_open
  expect(
    shouldRevealBrowserForCdpActivity({ kind: "cdp-method", method: "Page.captureScreenshot" }),
  ).toBe(false);
  expect(
    shouldRevealBrowserForCdpActivity({ kind: "cdp-method", method: "Input.dispatchMouseEvent" }),
  ).toBe(false);
});

test("agent_browser_open (Page.navigate*) does reveal browser panel", () => {
  expect(shouldRevealBrowserForCdpActivity({ kind: "cdp-method", method: "Page.navigate" })).toBe(
    true,
  );
  expect(
    shouldRevealBrowserForCdpActivity({
      kind: "cdp-method",
      method: "Page.navigateToHistoryEntry",
    }),
  ).toBe(true);
  expect(shouldRevealBrowserForCdpActivity({ kind: "cdp-method", method: "Page.reload" })).toBe(
    true,
  );
});

test("detects eco agent browser open tool names and urls", () => {
  expect(isEcoAgentBrowserOpenToolName("mcp__eco_agent_browser__agent_browser_open")).toBe(true);
  expect(isEcoAgentBrowserOpenToolName("agent_browser_open")).toBe(true);
  expect(isEcoAgentBrowserOpenToolName("mcp__eco_agent_browser__agent_browser_snapshot")).toBe(
    true,
  );
  expect(isEcoAgentBrowserOpenToolName("Bash")).toBe(false);
  expect(
    extractUrlFromBrowserOpenToolPayload({ input: { url: "https://google.com" } }),
  ).toBe("https://google.com");
});
