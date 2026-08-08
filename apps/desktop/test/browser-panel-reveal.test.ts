import { expect, test } from "bun:test";
import {
  ecoAgentBrowserAllowedToolPatternForThread,
  ecoAgentBrowserRuntimeServerName,
  extractUrlFromBrowserOpenToolPayload,
  isEcoAgentBrowserOpenToolName,
  isEcoAgentBrowserRuntimeServerName,
  normalizeBrowserNavigateUrl,
  shouldOpenAgentUrlInNewBrowser,
  shouldRevealBrowserForCdpActivity,
} from "../src/shared/browser";

test("open different origin forces new Eco tab (no overwrite)", () => {
  expect(
    shouldOpenAgentUrlInNewBrowser("https://chat.deepseek.com/", "https://chatgpt.com"),
  ).toBe(true);
  expect(
    shouldOpenAgentUrlInNewBrowser("https://chat.deepseek.com/a/chat", "chat.deepseek.com"),
  ).toBe(false);
  expect(shouldOpenAgentUrlInNewBrowser("about:blank", "https://chatgpt.com")).toBe(false);
  expect(shouldOpenAgentUrlInNewBrowser("", "https://chatgpt.com")).toBe(false);
});

test("browser MCP logical name stays fixed (no eco_ab multi-name)", () => {
  expect(ecoAgentBrowserRuntimeServerName("thr_1786166513794")).toBe("eco_agent_browser");
  expect(ecoAgentBrowserRuntimeServerName("thr_1786166511000")).toBe("eco_agent_browser");
  expect(isEcoAgentBrowserRuntimeServerName("eco_agent_browser")).toBe(true);
  expect(isEcoAgentBrowserRuntimeServerName("github")).toBe(false);
  expect(ecoAgentBrowserAllowedToolPatternForThread("thr_x")).toBe("mcp__eco_agent_browser__*");
});

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
  expect(
    shouldRevealBrowserForCdpActivity({ kind: "cdp-method", method: "Target.createTarget" }),
  ).toBe(true);
  expect(
    shouldRevealBrowserForCdpActivity({ kind: "cdp-method", method: "Target.activateTarget" }),
  ).toBe(true);
});

test("detects eco agent browser open tool names and urls", () => {
  expect(isEcoAgentBrowserOpenToolName("mcp__eco_agent_browser__agent_browser_open")).toBe(true);
  expect(isEcoAgentBrowserOpenToolName("agent_browser_open")).toBe(true);
  expect(isEcoAgentBrowserOpenToolName("mcp__eco_agent_browser__agent_browser_snapshot")).toBe(
    false,
  );
  expect(isEcoAgentBrowserOpenToolName("mcp__eco_agent_browser__agent_browser_click")).toBe(false);
  expect(isEcoAgentBrowserOpenToolName("Bash")).toBe(false);
  expect(
    extractUrlFromBrowserOpenToolPayload({ input: { url: "https://google.com" } }),
  ).toBe("https://google.com");
});

test("does not treat tool.started / tool.completed event labels as browser URLs", () => {
  expect(normalizeBrowserNavigateUrl("tool.started")).toBeUndefined();
  expect(normalizeBrowserNavigateUrl("tool.completed")).toBeUndefined();
  expect(extractUrlFromBrowserOpenToolPayload({ url: "tool.completed" })).toBeUndefined();
  expect(
    extractUrlFromBrowserOpenToolPayload({
      liveType: "tool.started",
      detail: "tool.completed",
      name: "mcp__eco_agent_browser__agent_browser_snapshot",
    }),
  ).toBeUndefined();
  expect(
    extractUrlFromBrowserOpenToolPayload({
      tool: { name: "agent_browser_open", detail: "tool.started" },
    }),
  ).toBeUndefined();
});
