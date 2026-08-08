import { expect, test } from "bun:test";
import { BrowserMcpAuthRegistry } from "../src/main/browser-mcp-auth";
import { BrowserMcpToolClaimRouter } from "../src/main/browser-mcp-router";
import {
  ECO_AGENT_BROWSER_ALLOWED_TOOL,
  ECO_AGENT_BROWSER_MCP_SERVER,
  buildEcoAgentBrowserPromptAppend,
  isEcoAgentBrowserRuntimeServerName,
} from "../src/shared/browser";
import { mergeEcoBrowserSdkConfig } from "../src/main/browser-mcp-gateway";

test("auth registry issues unique thread tokens", () => {
  const reg = new BrowserMcpAuthRegistry();
  const a = reg.issue("thr_a");
  const b = reg.issue("thr_b");
  expect(a.token).not.toBe(b.token);
  expect(reg.resolve(a.token)?.threadId).toBe("thr_a");
  expect(reg.resolve(b.token)?.threadId).toBe("thr_b");
  reg.revokeThread("thr_a");
  expect(reg.resolve(a.token)).toBeUndefined();
});

test("claim router FIFO with tool name preference", () => {
  const r = new BrowserMcpToolClaimRouter();
  r.noteUpcoming("thr_a", "agent_browser_open");
  r.noteUpcoming("thr_b", "agent_browser_snapshot");
  expect(r.claim("agent_browser_snapshot")).toBe("thr_b");
  expect(r.claim("agent_browser_open")).toBe("thr_a");
  expect(r.claim("anything")).toBeUndefined();
});

test("logical MCP server name is always eco_agent_browser", () => {
  expect(ECO_AGENT_BROWSER_MCP_SERVER).toBe("eco_agent_browser");
  expect(isEcoAgentBrowserRuntimeServerName("eco_agent_browser")).toBe(true);
  expect(buildEcoAgentBrowserPromptAppend("thr_x")).toContain("mcp__eco_agent_browser__*");
  expect(buildEcoAgentBrowserPromptAppend("thr_x")).toContain("auth");
});

test("merge eco browser SDK config keeps fixed server name", () => {
  const merged = mergeEcoBrowserSdkConfig(
    { mcpServers: { docs: { type: "stdio", command: "echo" } }, allowedTools: ["mcp__docs__*"] },
    {
      enabled: true,
      autoApproveTools: true,
      sdkEntry: { type: "stdio", command: "node", args: ["x.mjs"] },
    },
  );
  expect(merged.mcpServers.eco_agent_browser).toBeDefined();
  expect(merged.mcpServers.eco_ab_ea4a60abe66).toBeUndefined();
  expect(merged.allowedTools).toContain(ECO_AGENT_BROWSER_ALLOWED_TOOL);
});
