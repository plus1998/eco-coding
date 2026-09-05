import { expect, test } from "bun:test";
import {
  isPiMcpProxyToolName,
  resolvePiMcpProxyCall,
  resolvePiMcpProxyToolName,
} from "../src/shared/pi-mcp-proxy";

test("isPiMcpProxyToolName matches only pi gateway tools", () => {
  expect(isPiMcpProxyToolName("mcp")).toBe(true);
  expect(isPiMcpProxyToolName("mcpScript")).toBe(true);
  expect(isPiMcpProxyToolName("mcp_tool")).toBe(true);
  expect(isPiMcpProxyToolName("MCP")).toBe(true);
  expect(isPiMcpProxyToolName("read")).toBe(false);
  expect(isPiMcpProxyToolName(undefined)).toBe(false);
});

test("resolvePiMcpProxyCall reads tool, server, and nested args", () => {
  const call = resolvePiMcpProxyCall("mcp", {
    tool: "eco_agent_browser.agent_browser_open",
    args: { url: "https://example.com" },
  });
  expect(call).toEqual({
    tool: "eco_agent_browser.agent_browser_open",
    args: { url: "https://example.com" },
  });

  const withServer = resolvePiMcpProxyCall("mcp", {
    tool: "create_image",
    server: "eco_image_generation",
    args: { prompt: "a cat" },
  });
  expect(withServer?.server).toBe("eco_image_generation");
  expect(withServer?.args).toEqual({ prompt: "a cat" });
});

test("resolvePiMcpProxyCall accepts JSON-string args", () => {
  const call = resolvePiMcpProxyCall("mcp", {
    tool: "eco_web_search.search",
    args: '{"query":"eco desktop"}',
  });
  expect(call?.args).toEqual({ query: "eco desktop" });
});

test("resolvePiMcpProxyCall reads the first tools call from mcpScript code", () => {
  const call = resolvePiMcpProxyCall("mcpScript", {
    code: 'const items = await tools.eco_image_generation_create_image({ prompt: "x" }); emit(items);',
  });
  expect(call?.tool).toBe("eco_image_generation_create_image");
});

test("resolvePiMcpProxyCall is undefined for gateway probes", () => {
  expect(resolvePiMcpProxyCall("mcp", {})).toBeUndefined();
  expect(resolvePiMcpProxyCall("mcp", { search: "browser" })).toBeUndefined();
  expect(resolvePiMcpProxyCall("mcp", { describe: "x" })).toBeUndefined();
  expect(resolvePiMcpProxyCall("mcp", { server: "eco_agent_browser" })).toBeUndefined();
  expect(resolvePiMcpProxyCall("mcpScript", { code: "emit(1)" })).toBeUndefined();
  expect(resolvePiMcpProxyCall("read", { tool: "x" })).toBeUndefined();
});

test("resolvePiMcpProxyToolName canonicalizes explicit server calls", () => {
  expect(resolvePiMcpProxyToolName("mcp", { tool: "create_image", server: "eco_image_generation" })).toBe(
    "mcp__eco_image_generation__create_image",
  );
});

test("resolvePiMcpProxyToolName strips known eco integration prefixes", () => {
  expect(resolvePiMcpProxyToolName("mcp", { tool: "eco_agent_browser_agent_browser_open" })).toBe(
    "mcp__eco_agent_browser__agent_browser_open",
  );
  expect(resolvePiMcpProxyToolName("mcp", { tool: "eco_computer_use.click" })).toBe(
    "mcp__eco_computer_use__click",
  );
  expect(resolvePiMcpProxyToolName("mcp", { tool: "eco_image_generation_create_image" })).toBe(
    "mcp__eco_image_generation__create_image",
  );
});

test("resolvePiMcpProxyToolName keeps mcp__ tokens as-is", () => {
  expect(resolvePiMcpProxyToolName("mcp", { tool: "mcp__linear__create_issue" })).toBe(
    "mcp__linear__create_issue",
  );
});

test("resolvePiMcpProxyToolName stays undefined for anonymous third-party tools", () => {
  expect(resolvePiMcpProxyToolName("mcp", { tool: "linear_create_issue" })).toBeUndefined();
  expect(resolvePiMcpProxyToolName("mcp", { tool: "click" })).toBeUndefined();
});
