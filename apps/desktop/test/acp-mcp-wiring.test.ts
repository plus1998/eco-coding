import { expect, test } from "bun:test";
import fs from "node:fs";

const indexSource = fs.readFileSync(new URL("../src/main/index.ts", import.meta.url), "utf8");
const runSource = fs.readFileSync(new URL("../src/main/acp-runtime-run.ts", import.meta.url), "utf8");

test("ACP runtime deps map Eco session MCP onto Cursor session/new and session/load", () => {
  expect(indexSource).toContain("toAcpMcpServers");
  expect(indexSource).toContain("resolveAcpMcpServers:");
  const start = indexSource.indexOf("resolveAcpMcpServers:");
  expect(start).toBeGreaterThanOrEqual(0);
  const slice = indexSource.slice(start, start + 400);
  expect(slice).toContain("resolvePiSessionResourcesForThread");
  expect(slice).toContain("toAcpMcpServers(prepared.mcpServers)");
});

test("ACP continuation persists Composer runtime config before the next Cursor session/load", () => {
  const start = indexSource.indexOf("async function startAcpThreadContinuation");
  expect(start).toBeGreaterThanOrEqual(0);
  const slice = indexSource.slice(start, start + 1800);
  expect(slice).toContain("runtimeConfigInput");
  expect(slice).toContain("saveThreadRuntimeConfig");
  expect(slice).toContain("normalizeThreadRuntimeConfig");
});

test("ACP run always forwards resolved mcpServers to the driver", () => {
  expect(runSource).toContain("const mcpServers = deps.resolveAcpMcpServers");
  expect(runSource).toMatch(/mcpServers,\s*\}\)/);
});
