import { afterEach, expect, test } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ECO_IMAGE_VIEW_FULL_TOOL, ECO_IMAGE_VIEW_MCP_SERVER, ECO_IMAGE_VIEW_TOOL } from "@eco/runtime";
import { ImageViewMcpGateway } from "../src/main/image-view-mcp-gateway";
import {
  ECO_IMAGE_GENERATION_FULL_TOOL,
  ECO_IMAGE_GENERATION_MCP_SERVER,
} from "../src/shared/image-generation";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

const temporaryDirectories: string[] = [];
const gateways: ImageViewMcpGateway[] = [];

afterEach(async () => {
  await Promise.all(gateways.splice(0).map((gateway) => gateway.close()));
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

function createGateway(
  analyze: (input: { threadId: string; path: string; question?: string }) => Promise<string>,
) {
  const gateway = new ImageViewMcpGateway({ analyze });
  gateways.push(gateway);
  return gateway;
}

test("global image view Codex server starts once and has a stable HTTP definition", async () => {
  const gateway = createGateway(async () => "unused");
  const first = await gateway.resolveGlobalCodexServer();
  const second = await gateway.resolveGlobalCodexServer();
  expect(first.name).toBe(ECO_IMAGE_VIEW_MCP_SERVER);
  expect(first.transport).toBe("http");
  expect(first.enabledTools).toEqual([ECO_IMAGE_VIEW_TOOL]);
  expect(first.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
  expect(first.httpHeaders?.["X-Eco-Image-View-Control-Secret"]).toBeTruthy();
  expect(second).toEqual(first);
});

test("mergeIntoSdkConfig includes view_image in allowedTools", async () => {
  const gateway = createGateway(async () => "unused");
  const injection = await gateway.resolveInjection("thr_merge");
  expect(injection.sdkEntry).toMatchObject({
    type: "http",
    url: expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/),
  });
  const merged = gateway.mergeIntoSdkConfig(
    { mcpServers: { docs: { command: "echo" } }, allowedTools: ["mcp__docs__*"] },
    injection,
  );
  expect(merged.mcpServers[ECO_IMAGE_VIEW_MCP_SERVER]).toBeDefined();
  expect(merged.allowedTools).toContain(ECO_IMAGE_VIEW_FULL_TOOL);
  expect(merged.allowedTools).not.toContain(ECO_IMAGE_GENERATION_FULL_TOOL);
  expect(Object.keys(merged.mcpServers)).not.toContain(ECO_IMAGE_GENERATION_MCP_SERVER);
});

test("relative path fails without calling analyze", async () => {
  const calls: unknown[] = [];
  const gateway = createGateway(async (input) => {
    calls.push(input);
    return "should not run";
  });
  const server = await gateway.resolveGlobalCodexServer();
  const baseUrl = server.url!.replace(/\/mcp$/, "");
  gateway.noteUpcomingTool("thr_rel", ECO_IMAGE_VIEW_TOOL, "tool-rel");
  const response = await fetch(`${baseUrl}/v1/tools/call`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-eco-image-view-control-secret": server.httpHeaders!["X-Eco-Image-View-Control-Secret"]!,
    },
    body: JSON.stringify({ name: ECO_IMAGE_VIEW_TOOL, arguments: { path: "shot.png" } }),
  });
  const payload = (await response.json()) as {
    result: { isError?: boolean; content: Array<{ text: string }> };
  };
  expect(payload.result.isError).toBe(true);
  expect(payload.result.content[0]?.text).toContain("invalid_path");
  expect(calls).toEqual([]);
});

test("absolute PNG calls analyze once and returns text without image bytes", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "eco-image-view-mcp-"));
  temporaryDirectories.push(directory);
  const imagePath = path.join(directory, "shot.png");
  await fs.writeFile(imagePath, PNG);
  const calls: Array<{ path: string; question?: string; threadId: string }> = [];
  const gateway = createGateway(async (input) => {
    calls.push(input);
    return "## Overview\nred pixel";
  });
  const server = await gateway.resolveGlobalCodexServer();
  const baseUrl = server.url!.replace(/\/mcp$/, "");
  gateway.noteUpcomingTool("thr_abs", ECO_IMAGE_VIEW_TOOL, "tool-abs");
  const response = await fetch(`${baseUrl}/v1/tools/call`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-eco-image-view-control-secret": server.httpHeaders!["X-Eco-Image-View-Control-Secret"]!,
    },
    body: JSON.stringify({
      name: ECO_IMAGE_VIEW_TOOL,
      arguments: { path: imagePath, question: "找报错" },
    }),
  });
  const payload = (await response.json()) as {
    result: { isError?: boolean; content: Array<{ type: string; text: string }> };
  };
  expect(payload.result.isError).toBeUndefined();
  expect(payload.result.content).toEqual([{ type: "text", text: "## Overview\nred pixel" }]);
  expect(JSON.stringify(payload)).not.toContain("data:image");
  expect(JSON.stringify(payload)).not.toContain(PNG.toString("base64"));
  expect(calls).toEqual([
    { threadId: "thr_abs", path: imagePath, question: "找报错", toolUseId: "tool-abs" },
  ]);
});

test("streamable HTTP /mcp initialize + tools/list + tools/call", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "eco-image-view-mcp-http-"));
  temporaryDirectories.push(directory);
  const imagePath = path.join(directory, "shot.png");
  await fs.writeFile(imagePath, PNG);
  const gateway = createGateway(async () => "ok-report");
  const injection = await gateway.resolveInjection("thr_http");
  const url = String(injection.sdkEntry.url);
  const headers = injection.sdkEntry.headers as Record<string, string>;
  gateway.noteUpcomingTool("thr_http", ECO_IMAGE_VIEW_TOOL, "tool-http");

  const init = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "t", version: "0" } },
    }),
  });
  expect(init.status).toBe(200);
  expect(init.headers.get("mcp-session-id")).toBeTruthy();

  const listed = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
  });
  const listBody = (await listed.json()) as { result: { tools: Array<{ name: string }> } };
  expect(listBody.result.tools.some((tool) => tool.name === ECO_IMAGE_VIEW_TOOL)).toBe(true);

  const called = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: ECO_IMAGE_VIEW_TOOL, arguments: { path: imagePath } },
    }),
  });
  const callBody = (await called.json()) as {
    result: { content: Array<{ text: string }> };
  };
  expect(callBody.result.content[0]?.text).toBe("ok-report");
});
