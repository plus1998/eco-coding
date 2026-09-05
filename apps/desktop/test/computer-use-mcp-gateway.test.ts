import { expect, test } from "bun:test";
import fs from "node:fs";
import { ComputerUseMcpGateway } from "../src/main/computer-use-mcp-gateway";

test("eco-computer-use-mcp-stdio packaging script still exists for debug", () => {
  const packagingStdio = ComputerUseMcpGateway.packagingStdioScriptPath();
  expect(fs.existsSync(packagingStdio)).toBe(true);
  const src = fs.readFileSync(packagingStdio, "utf8");
  expect(src).toContain("/v1/tool-started");
  expect(src).toContain("ECO_OPEN_COMPUTER_USE_BINARY");
});

test("resolveInjection uses shared HTTP MCP (no per-session Electron stdio)", async () => {
  const gateway = new ComputerUseMcpGateway(() => ({
    agentIntegrationEnabled: true,
    actionApprovalMode: "always_allow",
  }));

  try {
    const first = await gateway.resolveInjection({
      threadId: "thr_presence",
      sessionEnabled: true,
    });
    const second = await gateway.resolveInjection({
      threadId: "thr_other",
      sessionEnabled: true,
    });
    if (!first.enabled || !first.sdkEntry || !second.enabled || !second.sdkEntry) {
      expect(first.enabled).toBe(false);
      return;
    }

    expect(first.sdkEntry.type).toBe("http");
    expect(String(first.sdkEntry.url)).toMatch(/\/mcp$/);
    expect(first.sdkEntry.url).toBe(second.sdkEntry.url);
    expect(first.codexServer?.transport).toBe("http");
    expect(first.sdkEntry).not.toHaveProperty("command");
    expect(first.sdkEntry.env?.ELECTRON_RUN_AS_NODE).toBeUndefined();

    const headers = first.sdkEntry.headers as Record<string, string>;
    const response = await fetch(`${String(first.sdkEntry.url).replace(/\/mcp$/, "")}/v1/tool-started`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Eco-Computer-Use-Control-Secret": headers["X-Eco-Computer-Use-Control-Secret"]!,
      },
      body: JSON.stringify({
        name: "click",
        arguments: { x: 10, y: 20 },
        threadId: "thr_presence",
      }),
    });
    expect(response.ok).toBe(true);
  } finally {
    await gateway.close();
  }
});
