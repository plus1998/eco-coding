import { expect, test } from "bun:test";
import { IntegratedWebSearchMcpGateway } from "../src/main/integrated-web-search-mcp-gateway";
import {
  ECO_WEB_SEARCH_FULL_TOOL,
  ECO_WEB_SEARCH_MCP_SERVER,
  isEcoWebSearchToolName,
} from "../src/shared/integrated-web-search";
import { resolveActionKind } from "../src/shared/feed-action-kind";
import { resolveThreadWebSearchPlan } from "../src/main/resolve-thread-web-search";

test("resolveThreadWebSearchPlan mirrors cross-core decision table", () => {
  expect(
    resolveThreadWebSearchPlan({
      networkWebSearch: true,
      plannerManualSpec: { supportsNativeWebSearch: false },
      integratedSettings: { enabled: true, provider: "tavily", hasApiKey: true },
      integratedApiKey: "tvly-test",
    }).backend,
  ).toBe("integrated");

  // Integrated settings take priority over the per-model native default.
  expect(
    resolveThreadWebSearchPlan({
      networkWebSearch: true,
      plannerManualSpec: { supportsNativeWebSearch: true },
      integratedSettings: { enabled: true, provider: "tavily", hasApiKey: true },
      integratedApiKey: "tvly-test",
    }).backend,
  ).toBe("integrated");

  expect(
    resolveThreadWebSearchPlan({
      networkWebSearch: true,
      plannerManualSpec: { supportsNativeWebSearch: true },
      integratedSettings: { enabled: false, provider: "tavily", hasApiKey: true },
      integratedApiKey: "tvly-test",
    }).backend,
  ).toBe("native");

  expect(
    resolveThreadWebSearchPlan({
      networkWebSearch: false,
      plannerManualSpec: { supportsNativeWebSearch: false },
      integratedSettings: { enabled: true, provider: "tavily", hasApiKey: true },
      integratedApiKey: "tvly-test",
    }).backend,
  ).toBe("none");
});

test("isEcoWebSearchToolName only matches eco_web_search server", () => {
  expect(isEcoWebSearchToolName(ECO_WEB_SEARCH_FULL_TOOL)).toBe(true);
  expect(isEcoWebSearchToolName("mcp__eco_web_search__search")).toBe(true);
  expect(isEcoWebSearchToolName("mcp__other__search")).toBe(false);
  expect(isEcoWebSearchToolName("search")).toBe(false);
  expect(isEcoWebSearchToolName("WebSearch")).toBe(false);
});

test("feed maps eco web search MCP tool to webSearch action", () => {
  expect(resolveActionKind({ toolName: ECO_WEB_SEARCH_FULL_TOOL }).kind).toBe("webSearch");
  expect(resolveActionKind({ toolName: "mcp__other__search" }).kind).not.toBe("webSearch");
});

test("integrated web search Codex server starts when configured", async () => {
  const gateway = new IntegratedWebSearchMcpGateway({
    store: {
      get: () => ({ enabled: true, provider: "tavily", hasApiKey: true }),
    } as never,
    getApiKey: () => "tvly-test",
  });
  try {
    const first = await gateway.resolveGlobalCodexServer();
    const second = await gateway.resolveGlobalCodexServer();
    expect(first?.name).toBe(ECO_WEB_SEARCH_MCP_SERVER);
    expect(first?.env?.ECO_WEB_SEARCH_CONTROL_URL).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(second).toEqual(first);

    const injection = await gateway.resolveInjection({ threadId: "thread-1", sessionEnabled: true });
    expect(injection.enabled).toBe(true);
    const merged = gateway.mergeIntoSdkConfig(
      { mcpServers: {}, allowedTools: [] },
      injection,
    );
    expect(merged.allowedTools).toContain(ECO_WEB_SEARCH_FULL_TOOL);
    expect(Object.keys(merged.mcpServers)).toContain(ECO_WEB_SEARCH_MCP_SERVER);
  } finally {
    await gateway.close();
  }
});
