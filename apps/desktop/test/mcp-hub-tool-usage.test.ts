import { expect, test } from "bun:test";
import { buildEcoMcpHubToolUsage } from "../src/shared/mcp-hub-tool-usage";
import { buildImageViewPromptAppend } from "../src/shared/image-view-tool";
import { buildImageDisplayPromptAppend } from "../src/shared/image-display-tool";
import { buildEcoAgentBrowserPromptAppend } from "../src/shared/browser";

test("Hub tool usage tells agents to search and dispatch by the canonical tool id", () => {
  const prompt = buildEcoMcpHubToolUsage({ server: "eco_image_view", tool: "view_image" });
  expect(prompt).toContain("mcp__eco_mcp__search_tools");
  expect(prompt).toContain("mcp__eco_mcp__call_tool");
  expect(prompt).toContain("eco_image_view:view_image");
  expect(prompt).toContain("Do not call `mcp__eco_image_view__view_image`");
});

test("image view prompt matches the runtime-visible Hub instead of requiring a missing direct tool", () => {
  const prompt = buildImageViewPromptAppend();
  expect(prompt).toContain("mcp__eco_mcp__search_tools");
  expect(prompt).toContain("eco_image_view:view_image");
  expect(prompt).toContain("explicitly listed");
});

test("browser prompt accepts the Hub tool pair as available and does not require direct MCP exposure", () => {
  const prompt = buildEcoAgentBrowserPromptAppend();
  expect(prompt).toContain("mcp__eco_mcp__search_tools");
  expect(prompt).toContain("mcp__eco_mcp__call_tool");
  expect(prompt).toContain("If the Eco MCP Hub tools and direct");
  expect(prompt).not.toContain("If `mcp__eco_agent_browser__*` tools are missing");
});

test("image display prompt routes follow-up vision analysis through the Hub", () => {
  const prompt = buildImageDisplayPromptAppend();
  expect(prompt).toContain("eco_image_view:view_image");
  expect(prompt).toContain("mcp__eco_mcp__call_tool");
  expect(prompt).not.toContain("To analyze an image for yourself (vision report), use `mcp__eco_image_view__view_image`");
});
