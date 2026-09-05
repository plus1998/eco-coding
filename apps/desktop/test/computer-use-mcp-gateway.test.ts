import { expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ComputerUseMcpGateway } from "../src/main/computer-use-mcp-gateway";
import { ECO_COMPUTER_USE_MCP_SERVER } from "../src/shared/computer-use";

const packagingStdio = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../packaging/eco-computer-use-mcp-stdio.mjs",
);

test("eco-computer-use-mcp-stdio packaging script exists", () => {
  expect(fs.existsSync(packagingStdio)).toBe(true);
  const src = fs.readFileSync(packagingStdio, "utf8");
  expect(src).toContain("/v1/tool-started");
  expect(src).toContain("tools/call");
  expect(src).toContain("ECO_OPEN_COMPUTER_USE_BINARY");
});

test("resolveInjection uses Eco stdio proxy and control notifies presence", async () => {
  const calls: Array<{ threadId: string; toolName: string; toolInput?: Record<string, unknown> }> =
    [];
  const gateway = new ComputerUseMcpGateway(
    () => ({ agentIntegrationEnabled: true, actionApprovalMode: "always_allow" }),
    {
      onToolCall: (input) => {
        calls.push(input);
      },
    },
  );

  try {
    const injection = await gateway.resolveInjection({
      threadId: "thr_presence",
      sessionEnabled: true,
    });
    if (!injection.enabled || !injection.sdkEntry) {
      // Binary may be missing in CI — control path still covered when available.
      expect(injection.enabled).toBe(false);
      return;
    }

    const args = injection.sdkEntry.args as string[] | undefined;
    expect(args?.[0]).toContain("eco-computer-use-mcp-stdio.mjs");
    expect(injection.sdkEntry.command).toBe(process.execPath);

    const env = injection.sdkEntry.env as Record<string, string>;
    expect(env.ECO_COMPUTER_USE_CONTROL_URL).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(env.ECO_COMPUTER_USE_CONTROL_SECRET).toBeTruthy();
    expect(env.ECO_OPEN_COMPUTER_USE_BINARY).toBeTruthy();
    expect(env.ECO_COMPUTER_USE_THREAD_ID).toBe("thr_presence");
    expect(env.ELECTRON_RUN_AS_NODE).toBe("1");

    const response = await fetch(`${env.ECO_COMPUTER_USE_CONTROL_URL}/v1/tool-started`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Eco-Computer-Use-Control-Secret": env.ECO_COMPUTER_USE_CONTROL_SECRET,
      },
      body: JSON.stringify({
        name: "click",
        arguments: { x: 10, y: 20 },
        threadId: "thr_presence",
      }),
    });
    expect(response.ok).toBe(true);
    expect(calls).toEqual([
      {
        threadId: "thr_presence",
        toolName: `mcp__${ECO_COMPUTER_USE_MCP_SERVER}__click`,
        toolInput: { x: 10, y: 20 },
      },
    ]);
  } finally {
    await gateway.close();
  }
});
