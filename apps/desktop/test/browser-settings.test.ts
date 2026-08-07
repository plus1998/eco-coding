import { expect, test } from "bun:test";
import {
  ECO_AGENT_BROWSER_ALLOWED_TOOL,
  ECO_AGENT_BROWSER_MCP_SERVER,
  appendBrowserPrompt,
  defaultBrowserSettings,
  isBrowserHttpUrl,
  isBrowserSettingsSnapshot,
  normalizeBrowserNavigateUrl,
  normalizeBrowserSettingsSnapshot,
} from "../src/shared/browser";
import { FORBIDDEN_CDP_PORT } from "../src/main/browser-cdp-proxy";
import { isHttpishHref } from "../src/renderer/browser-link";

test("normalizeBrowserSettingsSnapshot defaults agent integration off", () => {
  expect(normalizeBrowserSettingsSnapshot({})).toEqual({ agentIntegrationEnabled: false });
  expect(normalizeBrowserSettingsSnapshot({ agentIntegrationEnabled: true })).toEqual({
    agentIntegrationEnabled: true,
  });
  expect(normalizeBrowserSettingsSnapshot({ agentIntegrationEnabled: "yes" })).toEqual({
    agentIntegrationEnabled: false,
  });
});

test("isBrowserSettingsSnapshot validates shape", () => {
  expect(isBrowserSettingsSnapshot(defaultBrowserSettings())).toBe(true);
  expect(isBrowserSettingsSnapshot({ agentIntegrationEnabled: false })).toBe(true);
  expect(isBrowserSettingsSnapshot({})).toBe(false);
  expect(isBrowserSettingsSnapshot(null)).toBe(false);
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

test("mcp server constants", () => {
  expect(ECO_AGENT_BROWSER_MCP_SERVER).toBe("eco_agent_browser");
  expect(ECO_AGENT_BROWSER_ALLOWED_TOOL).toBe("mcp__eco_agent_browser__*");
});

test("isHttpishHref for feed links", () => {
  expect(isHttpishHref("https://example.com/docs")).toBe(true);
  expect(isHttpishHref("http://localhost:3000")).toBe(true);
  expect(isHttpishHref("/relative")).toBe(false);
  expect(isHttpishHref("eco-file:/tmp/x")).toBe(false);
});
