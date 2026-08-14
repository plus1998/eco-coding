import { afterEach, expect, test } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ImageViewMcpGateway } from "../src/main/image-view-mcp-gateway";
import {
  ECO_IMAGE_GENERATION_FULL_TOOL,
  ECO_IMAGE_GENERATION_MCP_SERVER,
} from "../src/shared/image-generation";
import { ECO_IMAGE_VIEW_FULL_TOOL, ECO_IMAGE_VIEW_MCP_SERVER, ECO_IMAGE_VIEW_TOOL } from "@eco/runtime";

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

function createGateway(analyze: (input: { threadId: string; path: string; question?: string }) => Promise<string>) {
  const gateway = new ImageViewMcpGateway({ analyze });
  gateways.push(gateway);
  return gateway;
}

test("global image view Codex server starts once and has a stable definition", async () => {
  const gateway = createGateway(async () => "unused");
  const first = await gateway.resolveGlobalCodexServer();
  const second = await gateway.resolveGlobalCodexServer();
  expect(first.name).toBe(ECO_IMAGE_VIEW_MCP_SERVER);
  expect(first.enabledTools).toEqual([ECO_IMAGE_VIEW_TOOL]);
  expect(first.env?.ECO_IMAGE_VIEW_CONTROL_URL).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  expect(second).toEqual(first);
});

test("mergeIntoSdkConfig includes view_image in allowedTools", async () => {
  const gateway = createGateway(async () => "unused");
  const injection = await gateway.resolveInjection("thr_merge");
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
  gateway.noteUpcomingTool("thr_rel", ECO_IMAGE_VIEW_TOOL, "tool-rel");
  const response = await fetch(`${server.env!.ECO_IMAGE_VIEW_CONTROL_URL}/v1/tools/call`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-eco-image-view-control-secret": server.env!.ECO_IMAGE_VIEW_CONTROL_SECRET,
    },
    body: JSON.stringify({ name: ECO_IMAGE_VIEW_TOOL, arguments: { path: "shot.png" } }),
  });
  const payload = (await response.json()) as { result: { isError?: boolean; content: Array<{ text: string }> } };
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
  gateway.noteUpcomingTool("thr_abs", ECO_IMAGE_VIEW_TOOL, "tool-abs");
  const response = await fetch(`${server.env!.ECO_IMAGE_VIEW_CONTROL_URL}/v1/tools/call`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-eco-image-view-control-secret": server.env!.ECO_IMAGE_VIEW_CONTROL_SECRET,
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
