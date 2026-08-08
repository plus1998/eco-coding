import { expect, test } from "bun:test";
import {
  ECO_AGENT_BROWSER_ALLOWED_TOOL,
  ECO_AGENT_BROWSER_MCP_SERVER,
  appendBrowserPrompt,
  browserAgentSessionKey,
  browserTaskTabId,
  defaultBrowserSettings,
  isBrowserHttpUrl,
  isBrowserSettingsSnapshot,
  isBrowserTaskTabId,
  isEcoAgentBrowserEnabledInSettingsMap,
  normalizeBrowserNavigateUrl,
  normalizeBrowserSettingsSnapshot,
  parseBrowserTaskTabId,
  partitionForBrowserWorkspace,
  requiresBrowserOpenApproval,
  shouldAutoApproveEcoAgentBrowserTools,
} from "../src/shared/browser";
import { FORBIDDEN_CDP_PORT } from "../src/main/browser-cdp-proxy";
import { isHttpishHref } from "../src/renderer/browser-link";

test("normalizeBrowserSettingsSnapshot defaults agent integration off and open always allow", () => {
  expect(normalizeBrowserSettingsSnapshot({})).toEqual({
    agentIntegrationEnabled: false,
    openApprovalMode: "always_allow",
  });
  expect(normalizeBrowserSettingsSnapshot({ agentIntegrationEnabled: true })).toEqual({
    agentIntegrationEnabled: true,
    openApprovalMode: "always_allow",
  });
  expect(
    normalizeBrowserSettingsSnapshot({
      agentIntegrationEnabled: true,
      openApprovalMode: "always_ask",
    }),
  ).toEqual({
    agentIntegrationEnabled: true,
    openApprovalMode: "always_ask",
  });
  expect(normalizeBrowserSettingsSnapshot({ agentIntegrationEnabled: "yes" })).toEqual({
    agentIntegrationEnabled: false,
    openApprovalMode: "always_allow",
  });
});

test("isBrowserSettingsSnapshot validates shape", () => {
  expect(isBrowserSettingsSnapshot(defaultBrowserSettings())).toBe(true);
  expect(isBrowserSettingsSnapshot({ agentIntegrationEnabled: false })).toBe(true);
  expect(
    isBrowserSettingsSnapshot({
      agentIntegrationEnabled: true,
      openApprovalMode: "always_ask",
    }),
  ).toBe(true);
  expect(
    isBrowserSettingsSnapshot({
      agentIntegrationEnabled: true,
      openApprovalMode: "invalid",
    }),
  ).toBe(false);
  expect(isBrowserSettingsSnapshot({})).toBe(false);
  expect(isBrowserSettingsSnapshot(null)).toBe(false);
});

test("requiresBrowserOpenApproval only for open / tab_new navigations", () => {
  expect(requiresBrowserOpenApproval("mcp__eco_agent_browser__agent_browser_open")).toBe(true);
  expect(requiresBrowserOpenApproval("mcp__eco_agent_browser__agent_browser_tab_new")).toBe(true);
  expect(requiresBrowserOpenApproval("mcp__eco_agent_browser__agent_browser_snapshot")).toBe(
    false,
  );
  expect(requiresBrowserOpenApproval("mcp__eco_agent_browser__agent_browser_click")).toBe(false);
  expect(requiresBrowserOpenApproval("Bash")).toBe(false);
});

test("shouldAutoApproveEcoAgentBrowserTools follows openApprovalMode", () => {
  expect(shouldAutoApproveEcoAgentBrowserTools("always_allow")).toBe(true);
  expect(shouldAutoApproveEcoAgentBrowserTools("always_ask")).toBe(false);
});

test("normalizeBrowserNavigateUrl accepts http(s) and bare hosts", () => {
  expect(normalizeBrowserNavigateUrl("https://example.com/a")).toBe("https://example.com/a");
  expect(normalizeBrowserNavigateUrl("example.com")).toBe("https://example.com");
  expect(normalizeBrowserNavigateUrl("not a url")).toBeUndefined();
});

test("isBrowserHttpUrl", () => {
  expect(isBrowserHttpUrl("https://x.test")).toBe(true);
  expect(isBrowserHttpUrl("file:///tmp")).toBe(false);
});

test("appendBrowserPrompt only joins non-empty parts", () => {
  expect(appendBrowserPrompt(undefined, undefined)).toBeUndefined();
  expect(appendBrowserPrompt("rules", undefined)).toBe("rules");
  expect(appendBrowserPrompt(undefined, "browser")).toBe("browser");
  expect(appendBrowserPrompt("rules", "browser")).toBe("rules\n\nbrowser");
});

test("forbidden CDP port constant is 9222", () => {
  expect(FORBIDDEN_CDP_PORT).toBe(9222);
});

test("browser task tab ids are per browser; partitions are workspace-scoped", () => {
  expect(browserTaskTabId("abc")).toBe("browser:abc");
  expect(parseBrowserTaskTabId("browser:abc")).toBe("abc");
  expect(isBrowserTaskTabId("browser:abc")).toBe(true);
  expect(isBrowserTaskTabId("__browser__")).toBe(false);
  const wsA = "/Users/me/proj-a";
  const wsB = "/Users/me/proj-b";
  expect(partitionForBrowserWorkspace(wsA)).toMatch(/^persist:eco-browser-w-[0-9a-f]{16}$/);
  expect(partitionForBrowserWorkspace(wsA)).toBe(partitionForBrowserWorkspace(`${wsA}/`));
  expect(partitionForBrowserWorkspace(wsA)).toBe(partitionForBrowserWorkspace(wsA.replace(/\//g, "\\")));
  expect(partitionForBrowserWorkspace(wsA)).not.toBe(partitionForBrowserWorkspace(wsB));
  // Different threads in the same workspace share one storage bucket.
  expect(partitionForBrowserWorkspace(wsA)).toBe(partitionForBrowserWorkspace(wsA));
  expect(browserAgentSessionKey("thr_1/x")).toMatch(/^e[0-9a-f]{10}$/);
  expect(browserAgentSessionKey("thr_a")).not.toBe(browserAgentSessionKey("thr_b"));
  expect(browserAgentSessionKey("thr_1786165124188").length).toBeLessThan(16);
  expect(isEcoAgentBrowserEnabledInSettingsMap({ eco_agent_browser: true })).toBe(true);
  expect(isEcoAgentBrowserEnabledInSettingsMap({ eco_agent_browser: false })).toBe(false);
  expect(isEcoAgentBrowserEnabledInSettingsMap(undefined)).toBe(false);
});

test("isHttpishHref for feed links", () => {
  expect(isHttpishHref("https://example.com/docs")).toBe(true);
  expect(isHttpishHref("http://localhost:3000")).toBe(true);
  expect(isHttpishHref("/relative")).toBe(false);
  expect(isHttpishHref("eco-file:/tmp/x")).toBe(false);
});
