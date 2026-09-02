import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  ECO_IMAGE_VIEW_FULL_TOOL as NAMED_FULL_TOOL,
  isEcoImageViewToolName as namedIsEcoImageViewToolName,
} from "../src/eco-image-view-names";
import {
  ECO_IMAGE_VIEW_FULL_TOOL,
  ECO_IMAGE_VIEW_MCP_SERVER,
  ECO_IMAGE_VIEW_TOOL,
  isEcoImageViewToolName,
  readImageViewPathFromToolArgs,
  resolveEcoImageViewToolCall,
  resolvePiMcpProxyDiscoveryCall,
} from "../src/eco-image-view-tool";

test("recognizes Eco image view MCP names", () => {
  expect(isEcoImageViewToolName(ECO_IMAGE_VIEW_FULL_TOOL)).toBe(true);
  expect(isEcoImageViewToolName(`mcp__${ECO_IMAGE_VIEW_MCP_SERVER}__${ECO_IMAGE_VIEW_TOOL}`)).toBe(true);
  expect(isEcoImageViewToolName("mcp__eco_image_generation__create_image")).toBe(false);
  expect(isEcoImageViewToolName("ViewImage")).toBe(false);
  expect(isEcoImageViewToolName("view_image")).toBe(false);
});

test("image view names module stays usable in the Vite renderer", () => {
  const source = readFileSync(new URL("../src/eco-image-view-names.ts", import.meta.url), "utf8");
  expect(source).not.toContain("node:");
  expect(source).not.toContain("pi-mcp-adapter");
  expect(namedIsEcoImageViewToolName(NAMED_FULL_TOOL)).toBe(true);
});

test("readImageViewPathFromToolArgs only returns absolute paths for Eco view_image", () => {
  expect(readImageViewPathFromToolArgs(ECO_IMAGE_VIEW_FULL_TOOL, { path: "/tmp/a.png" })).toBe("/tmp/a.png");
  expect(readImageViewPathFromToolArgs(ECO_IMAGE_VIEW_FULL_TOOL, { path: "relative.png" })).toBe(undefined);
  expect(readImageViewPathFromToolArgs("Read", { path: "/tmp/a.png" })).toBe(undefined);
});

test("readImageViewPathFromToolArgs unwraps PI mcp proxy view_image calls", () => {
  expect(
    readImageViewPathFromToolArgs("mcp", {
      tool: "view_image",
      server: "eco_image_view",
      args: '{"path":"/tmp/shot.png"}',
    }),
  ).toBe("/tmp/shot.png");
  expect(
    readImageViewPathFromToolArgs("mcp", {
      tool: "view_image",
      args: { path: "/Users/gareth/Downloads/IMG_2743.jpg" },
    }),
  ).toBe("/Users/gareth/Downloads/IMG_2743.jpg");
  expect(
    readImageViewPathFromToolArgs("mcp", {
      tool: "view_image",
      args: '{"path":"relative.png"}',
    }),
  ).toBe(undefined);
  expect(
    readImageViewPathFromToolArgs("mcp", {
      search: "view image",
    }),
  ).toBe(undefined);
  expect(
    resolveEcoImageViewToolCall("mcp", {
      tool: "view_image",
      server: "eco_image_view",
      args: '{"path":"/tmp/shot.png"}',
    }),
  ).toEqual({
    name: ECO_IMAGE_VIEW_FULL_TOOL,
    path: "/tmp/shot.png",
  });
});

test("resolvePiMcpProxyDiscoveryCall labels PI mcp search/action probes", () => {
  expect(resolvePiMcpProxyDiscoveryCall("mcp", { search: "view image" })).toEqual({ kind: "search" });
  expect(resolvePiMcpProxyDiscoveryCall("mcp", { action: "list_tools" })).toEqual({ kind: "search" });
  expect(resolvePiMcpProxyDiscoveryCall("mcpScript", { search: "" })).toEqual({ kind: "search" });
  expect(
    resolvePiMcpProxyDiscoveryCall("mcp", {
      tool: "view_image",
      args: { path: "/tmp/shot.png" },
    }),
  ).toBe(undefined);
  expect(resolvePiMcpProxyDiscoveryCall("mcp__eco_image_view__view_image", { search: "x" })).toBe(undefined);
});
