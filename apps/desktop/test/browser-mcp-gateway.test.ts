import { expect, test } from "bun:test";
import { BrowserMcpAuthRegistry } from "../src/main/browser-mcp-auth";
import { BrowserMcpGateway, mergeEcoBrowserSdkConfig } from "../src/main/browser-mcp-gateway";
import { BrowserMcpToolClaimRouter } from "../src/main/browser-mcp-router";
import {
  buildEcoAgentBrowserPromptAppend,
  ECO_AGENT_BROWSER_ALLOWED_TOOL,
  ECO_AGENT_BROWSER_MCP_SERVER,
  isEcoAgentBrowserRuntimeServerName,
} from "../src/shared/browser";

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

test("claim router preserves toolUseId and isolates authenticated thread claims", () => {
  const router = new BrowserMcpToolClaimRouter();
  router.noteUpcoming("thr_a", "create_image", "tool-a");
  router.noteUpcoming("thr_b", "create_image", "tool-b");
  router.noteUpcoming("thr_a", "create_image", "tool-a");
  expect(router.claimDetails("create_image", "thr_b")).toMatchObject({
    threadId: "thr_b",
    toolUseId: "tool-b",
  });
  expect(router.claimDetails("create_image", "thr_a")).toMatchObject({
    threadId: "thr_a",
    toolUseId: "tool-a",
  });
  expect(router.claimDetails("create_image", "thr_a")).toBeUndefined();
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

test("global browser Codex server starts control plane without creating a thread CDP", async () => {
  let cdpRequests = 0;
  const gateway = new BrowserMcpGateway({
    ensureCdpPort: async () => {
      cdpRequests += 1;
      return 9222;
    },
    agentBrowserEnv: () => ({}),
  });
  try {
    const server = await gateway.prepareCodexServer();
    expect(server.name).toBe(ECO_AGENT_BROWSER_MCP_SERVER);
    expect(server.command).toBe(process.execPath);
    expect(server.env?.ECO_BROWSER_CONTROL_URL).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(cdpRequests).toBe(0);
  } finally {
    await gateway.close();
  }
});
