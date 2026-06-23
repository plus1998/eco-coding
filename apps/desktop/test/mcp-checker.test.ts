import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { checkMcpServerConnection } from "../src/main/mcp-checker";
import type { McpServerConfigInput } from "../src/shared/ipc";

test("checks stdio MCP server by initializing and listing tools", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "eco-mcp-check-"));
  try {
    const serverPath = path.join(tempDir, "server.js");
    await writeFile(
      serverPath,
      `
let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  for (;;) {
    const newline = buffer.indexOf("\\n");
    if (newline < 0) break;
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    if (!line) continue;
    const message = JSON.parse(line);
    if (message.method === "initialize") {
      write({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          protocolVersion: "2025-06-18",
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "fake-mcp", version: "1.0.0" }
        }
      });
    } else if (message.method === "tools/list") {
      write({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          tools: [
            { name: "echo", description: "Echo input", inputSchema: { type: "object" } }
          ]
        }
      });
    }
  }
});
function write(message) {
  process.stdout.write(JSON.stringify(message) + "\\n");
}
`,
    );

    const result = await checkMcpServerConnection(serverInput(serverPath), { timeoutMs: 2_000 });

    expect(result.ok).toBe(true);
    expect(result.protocolVersion).toBe("2025-06-18");
    expect(result.capabilities).toEqual(["tools"]);
    expect(result.toolsCount).toBe(1);
    expect(result.toolNames).toEqual(["echo"]);
    expect(result.serverInfo?.name).toBe("fake-mcp");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("fails stdio MCP check when stdout is not JSON-RPC", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "eco-mcp-check-"));
  try {
    const serverPath = path.join(tempDir, "bad-server.js");
    await writeFile(
      serverPath,
      `
process.stdout.write("ordinary log on stdout\\n");
setTimeout(() => {}, 10_000);
`,
    );

    const result = await checkMcpServerConnection(serverInput(serverPath), { timeoutMs: 2_000 });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("stdout");
    expect(result.message).toContain("JSON-RPC");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

function serverInput(serverPath: string): McpServerConfigInput {
  return {
    name: "fake",
    transport: "stdio",
    enabled: true,
    command: process.execPath,
    argsJson: JSON.stringify([serverPath]),
    envJson: "{}",
    headersJson: "{}",
    allowedTools: "",
  };
}
