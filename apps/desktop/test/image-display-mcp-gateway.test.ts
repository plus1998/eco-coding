import { afterEach, expect, test } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  ECO_IMAGE_DISPLAY_FULL_TOOL,
  ECO_IMAGE_DISPLAY_MCP_SERVER,
  ECO_IMAGE_DISPLAY_TOOL,
} from "@eco/runtime";
import { ImageDisplayMcpGateway } from "../src/main/image-display-mcp-gateway";
import { createImageDisplayStore } from "../src/main/image-display-store";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

const temporaryDirectories: string[] = [];
const gateways: ImageDisplayMcpGateway[] = [];
const stores: Array<{ close(): void }> = [];

afterEach(async () => {
  await Promise.all(gateways.splice(0).map((gateway) => gateway.close()));
  for (const store of stores.splice(0)) {
    store.close();
  }
  await Promise.all(
    temporaryDirectories.splice(0).map(async (directory) => {
      try {
        await fs.rm(directory, { recursive: true, force: true });
      } catch {
        // Windows may keep the temp sqlite file locked briefly after close.
      }
    }),
  );
});

async function createGateway() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "eco-image-display-"));
  temporaryDirectories.push(root);
  const store = await createImageDisplayStore(path.join(root, "display.db"), path.join(root, "files"));
  stores.push(store);
  const gateway = new ImageDisplayMcpGateway({
    store,
    onArtifactChanged: () => undefined,
  });
  gateways.push(gateway);
  return { gateway, store };
}

test("mergeIntoSdkConfig includes display_image in allowedTools", async () => {
  const { gateway } = await createGateway();
  const injection = await gateway.resolveInjection("thr_display");
  const merged = gateway.mergeIntoSdkConfig(
    { mcpServers: { docs: { command: "echo" } }, allowedTools: ["mcp__docs__*"] },
    injection,
  );
  expect(merged.mcpServers[ECO_IMAGE_DISPLAY_MCP_SERVER]).toBeDefined();
  expect(merged.allowedTools).toContain(ECO_IMAGE_DISPLAY_FULL_TOOL);
});

test("display_image base64 stores artifact and returns status ok only", async () => {
  const { gateway, store } = await createGateway();
  const server = await gateway.resolveGlobalCodexServer();
  gateway.noteUpcomingTool("thr_base64", ECO_IMAGE_DISPLAY_TOOL, "tool-display");
  const response = await fetch(`${server.env!.ECO_IMAGE_DISPLAY_CONTROL_URL}/v1/tools/call`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-eco-image-display-control-secret": server.env!.ECO_IMAGE_DISPLAY_CONTROL_SECRET,
    },
    body: JSON.stringify({
      name: ECO_IMAGE_DISPLAY_TOOL,
      arguments: { source: "base64", data: PNG.toString("base64"), mimeType: "image/png" },
    }),
  });
  const payload = (await response.json()) as {
    result: { content: Array<{ text: string }> };
  };
  const parsed = JSON.parse(payload.result.content[0]?.text ?? "{}") as Record<string, unknown>;
  expect(parsed).toEqual({ status: "ok" });
  expect(parsed.artifactId).toBeUndefined();
  const listed = store.listArtifacts("thr_base64");
  expect(listed).toHaveLength(1);
  expect(listed[0]?.toolUseId).toBe("tool-display");
  expect(store.getArtifactByToolUseId("tool-display")?.id).toBe(listed[0]?.id);
});
