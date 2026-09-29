import { afterEach, expect, test } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SharedMcpStdioUpstream } from "../src/main/shared-mcp-stdio-upstream";

const temporaryDirectories: string[] = [];
const upstreams: SharedMcpStdioUpstream[] = [];

afterEach(async () => {
  await Promise.all(upstreams.splice(0).map((upstream) => upstream.close()));
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

test("shared stdio upstream sends MCP cancellation when a tool call is aborted", async () => {
  if (process.platform === "win32") return;
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "eco-shared-mcp-abort-"));
  temporaryDirectories.push(directory);
  const marker = path.join(directory, "cancel.json");
  const executable = await writeFakeUpstream(directory);
  const upstream = new SharedMcpStdioUpstream();
  upstreams.push(upstream);
  await upstream.ensure(executable);

  const controller = new AbortController();
  const pending = upstream.callTool("slow_probe", { marker: "test" }, controller.signal);
  await waitForEvent(marker, "tools/call");
  controller.abort(new Error("test cancellation"));
  await expect(pending).rejects.toThrow("test cancellation");

  await waitForEvent(marker, "notifications/cancelled");
  const events = await readJsonEventually(marker);
  const cancellation = events.find((entry) => entry.method === "notifications/cancelled");
  expect(cancellation).toBeDefined();
  if (!cancellation) throw new Error("missing cancellation event");
  expect(cancellation.method).toBe("notifications/cancelled");
  expect(cancellation.requestId).toBe(2);
});

test("shared stdio upstream rejects a queued request immediately without writing it", async () => {
  if (process.platform === "win32") return;
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "eco-shared-mcp-queue-abort-"));
  temporaryDirectories.push(directory);
  const marker = path.join(directory, "cancel.json");
  const executable = await writeFakeUpstream(directory);
  const upstream = new SharedMcpStdioUpstream();
  upstreams.push(upstream);
  await upstream.ensure(executable);

  const firstController = new AbortController();
  const first = upstream.callTool("first_probe", {}, firstController.signal);
  await waitForEvent(marker, "tools/call");

  const queuedController = new AbortController();
  const queued = upstream.callTool("queued_probe", {}, queuedController.signal);
  queuedController.abort(new Error("queued cancellation"));
  await expect(
    Promise.race([
      queued,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("queued abort was delayed")), 250)),
    ]),
  ).rejects.toThrow("queued cancellation");

  const events = await readJsonEventually(marker);
  expect(events.some((entry) => entry.method === "tools/call" && entry.name === "queued_probe")).toBe(false);
  firstController.abort(new Error("finish first"));
  await expect(first).rejects.toThrow("finish first");
});

test("shared stdio upstream never sends notifications/cancelled for initialize", async () => {
  if (process.platform === "win32") return;
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "eco-shared-mcp-init-abort-"));
  temporaryDirectories.push(directory);
  const marker = path.join(directory, "cancel.json");
  const executable = await writeFakeUpstream(directory, { delayInitializeMs: 100 });
  const upstream = new SharedMcpStdioUpstream();
  upstreams.push(upstream);
  await upstream.ensure(executable);

  const controller = new AbortController();
  const pending = upstream.initialize(undefined, controller.signal);
  await waitForEvent(marker, "initialize");
  controller.abort(new Error("initialize cancellation"));
  await expect(pending).rejects.toThrow("initialize cancellation");
  await new Promise((resolve) => setTimeout(resolve, 150));
  const events = await readJsonEventually(marker);
  expect(events.some((entry) => entry.method === "notifications/cancelled")).toBe(false);
});

async function writeFakeUpstream(
  directory: string,
  options: { delayInitializeMs?: number } = {},
): Promise<string> {
  const executable = path.join(directory, "fake-upstream.mjs");
  const marker = path.join(directory, "cancel.json");
  const delayInitializeMs = options.delayInitializeMs ?? 0;
  await fs.writeFile(
    executable,
    `#!/usr/bin/env node
import fs from "node:fs";
import readline from "node:readline";
const marker = ${JSON.stringify(marker)};
const append = (entry) => {
  let events = [];
  try { events = JSON.parse(fs.readFileSync(marker, "utf8")); } catch {}
  events.push(entry);
  fs.writeFileSync(marker, JSON.stringify(events));
};
const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  let message;
  try { message = JSON.parse(line); } catch { return; }
  if (message.method === "initialize") {
    append({ method: message.method, requestId: message.id });
    setTimeout(() => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: {} }) + "\\n"), ${delayInitializeMs});
    return;
  }
  if (message.method === "notifications/cancelled") {
    append({ method: message.method, requestId: message.params?.requestId });
    return;
  }
  // Keep tools/call pending so the client must issue notifications/cancelled.
  if (message.method === "tools/call") append({ method: message.method, requestId: message.id, name: message.params?.name });
});
`,
    { mode: 0o755 },
  );
  return executable;
}

async function readJsonEventually(
  filePath: string,
): Promise<Array<{ method: string; requestId?: number; name?: string }>> {
  const deadline = Date.now() + 2_000;
  for (;;) {
    try {
      return JSON.parse(await fs.readFile(filePath, "utf8")) as Array<{
        method: string;
        requestId?: number;
        name?: string;
      }>;
    } catch (error) {
      if (Date.now() >= deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
}

async function waitForEvent(filePath: string, method: string): Promise<void> {
  const deadline = Date.now() + 2_000;
  for (;;) {
    try {
      const events = JSON.parse(await fs.readFile(filePath, "utf8")) as Array<{ method: string }>;
      if (events.some((entry) => entry.method === method)) return;
    } catch {
      // The child has not emitted its first event yet.
    }
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${method}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
