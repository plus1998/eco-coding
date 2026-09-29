import { expect, test } from "bun:test";
import {
  resolveEcoMcpHubSearchCall,
  resolveEcoMcpHubToolCall,
} from "../src/eco-mcp-hub-tool";

test("unwraps a Hub call into the nested canonical tool and arguments", () => {
  expect(
    resolveEcoMcpHubToolCall("mcp__eco_mcp__call_tool", {
      name: "eco_image_view:view_image",
      arguments: { path: "/tmp/example.png", prompt: "describe" },
    }),
  ).toEqual({
    name: "mcp__eco_image_view__view_image",
    args: { path: "/tmp/example.png", prompt: "describe" },
  });
});

test("accepts JSON encoded Hub arguments and labels search calls", () => {
  expect(
    resolveEcoMcpHubToolCall("mcp__eco_mcp__call_tool", {
      name: "eco_web_search:search",
      arguments: '{"query":"Eco MCP"}',
    }),
  ).toEqual({ name: "mcp__eco_web_search__search", args: { query: "Eco MCP" } });
  expect(resolveEcoMcpHubSearchCall("mcp__eco_mcp__search_tools", { query: "image" })).toEqual({
    query: "image",
  });
});

test("does not invent a nested target for malformed Hub calls", () => {
  expect(resolveEcoMcpHubToolCall("mcp__eco_mcp__call_tool", { name: "call_tool" })).toBeUndefined();
  expect(resolveEcoMcpHubToolCall("mcp__other__call_tool", { name: "eco_image_view:view_image" })).toBeUndefined();
});
