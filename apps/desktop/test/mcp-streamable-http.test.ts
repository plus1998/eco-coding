import { afterEach, expect, test } from "bun:test";
import http from "node:http";
import type { AddressInfo } from "node:net";
import {
  handleMcpStreamableHttpRequest,
  isJsonRpcNotification,
} from "../src/main/mcp-streamable-http";

const servers: http.Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
        }),
    ),
  );
});

async function listenTestServer(
  handlers: Parameters<typeof handleMcpStreamableHttpRequest>[2],
  secret = "secret-test",
): Promise<{ port: number; secret: string }> {
  const server = http.createServer((req, res) => {
    void handleMcpStreamableHttpRequest(req, res, handlers, {
      controlSecretHeader: "x-eco-test-control-secret",
      controlSecret: secret,
    });
  });
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.listen(0, "127.0.0.1", resolve);
    server.once("error", reject);
  });
  return { port: (server.address() as AddressInfo).port, secret };
}

test("isJsonRpcNotification detects Codex notifications/initialized", () => {
  expect(
    isJsonRpcNotification({
      jsonrpc: "2.0",
      method: "notifications/initialized",
    }),
  ).toBe(true);
  expect(
    isJsonRpcNotification({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
    }),
  ).toBe(false);
});

test("MCP streamable HTTP initialize tools/list tools/call round-trip", async () => {
  const { port, secret } = await listenTestServer({
    serverName: "eco_test",
    instructions: "test",
    listTools: async () => ({
      tools: [{ name: "ping", description: "ping", inputSchema: { type: "object" } }],
    }),
    callTool: async ({ name, authToken }) => ({
      content: [{ type: "text", text: `${name}:${authToken ?? ""}` }],
    }),
  });
  const url = `http://127.0.0.1:${port}/mcp`;
  const headers = {
    "content-type": "application/json",
    "x-eco-test-control-secret": secret,
    authorization: "Bearer thr-token",
  };

  const init = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "t", version: "0" } },
    }),
  });
  expect(init.status).toBe(200);
  expect(init.headers.get("mcp-session-id")).toBeTruthy();
  const initBody = (await init.json()) as { result: { serverInfo: { name: string } } };
  expect(initBody.result.serverInfo.name).toBe("eco_test");

  const list = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
  });
  const listBody = (await list.json()) as { result: { tools: Array<{ name: string }> } };
  expect(listBody.result.tools[0]?.name).toBe("ping");

  const call = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "ping", arguments: {} },
    }),
  });
  const callBody = (await call.json()) as { result: { content: Array<{ text: string }> } };
  expect(callBody.result.content[0]?.text).toBe("ping:thr-token");
});

test("Codex handshake: notifications/initialized returns 202 empty; GET is 405", async () => {
  const { port, secret } = await listenTestServer({
    serverName: "eco_agent_browser",
    listTools: async () => ({
      tools: [
        {
          name: "agent_browser_open",
          description: "open",
          inputSchema: { type: "object", properties: { url: { type: "string" } } },
        },
      ],
    }),
    callTool: async () => ({ content: [{ type: "text", text: "ok" }] }),
  });
  const url = `http://127.0.0.1:${port}/mcp`;
  // Codex Accept prefers event-stream first; we still answer with application/json.
  const headers = {
    accept: "text/event-stream, application/json",
    "content-type": "application/json",
    "x-eco-test-control-secret": secret,
  };

  const init = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 0,
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "codex_test", version: "0.150.1" },
      },
    }),
  });
  expect(init.status).toBe(200);
  const sessionId = init.headers.get("mcp-session-id");
  expect(sessionId).toBeTruthy();
  const initBody = (await init.json()) as { result: { protocolVersion: string } };
  expect(initBody.result.protocolVersion).toBe("2025-03-26");

  const notified = await fetch(url, {
    method: "POST",
    headers: {
      ...headers,
      ...(sessionId ? { "mcp-session-id": sessionId } : {}),
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "notifications/initialized",
    }),
  });
  expect(notified.status).toBe(202);
  expect(await notified.text()).toBe("");

  const list = await fetch(url, {
    method: "POST",
    headers: {
      ...headers,
      ...(sessionId ? { "mcp-session-id": sessionId } : {}),
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  expect(list.status).toBe(200);
  const listBody = (await list.json()) as { result: { tools: Array<{ name: string }> } };
  expect(listBody.result.tools.map((t) => t.name)).toEqual(["agent_browser_open"]);

  const get = await fetch(url, { method: "GET", headers });
  expect(get.status).toBe(405);
  expect(await get.text()).toBe("");
});

test("probeCodexStyleHttpMcpHandshake accepts Codex Accept header + 202 notification", async () => {
  const { probeCodexStyleHttpMcpHandshake } = await import("../src/main/mcp-streamable-http");
  const { port, secret } = await listenTestServer({
    serverName: "eco_probe",
    listTools: async () => ({
      tools: [{ name: "t", description: "t", inputSchema: { type: "object" } }],
    }),
    callTool: async () => ({ content: [{ type: "text", text: "ok" }] }),
  });
  const result = await probeCodexStyleHttpMcpHandshake({
    name: "eco_probe",
    url: `http://127.0.0.1:${port}/mcp`,
    headers: { "x-eco-test-control-secret": secret },
  });
  expect(result.toolCount).toBe(1);
});
