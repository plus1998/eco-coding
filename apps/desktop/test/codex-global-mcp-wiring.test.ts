import { expect, test } from "bun:test";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../src/main/index.ts", import.meta.url), "utf8");

test("Codex global MCP runtime is populated only with thread-scoped Hub descriptors", () => {
  expect(source).toContain("listGlobalMcpServers: resolveCodexGlobalMcpServers");
  expect(source).toContain("configuredServers: mcpHubGateway.listThreadCodexServers()");
  expect(source).toContain("builtinServerResolvers: []");
  expect(source).not.toContain("buildCodexMcpServersForConfigSync(mcpStore.listServers()");
  expect(source).toMatch(/resolveMcpServers:\s*async \(\) => \{\s*const configuredMcp = mcpStore\.buildSdkConfig\(\)/);
  expect(source).toContain("mcpHubGateway.registerThreadServerEntry");
  expect(source).toContain("allowedServers: [...hubMcpKeys, ...builtinHubServers]");
  expect(source).toContain("mcpHubGateway.prepareThreadFromSdkConfig");
  expect(source).toContain("runtimeName: codexHubName");
  expect(source).toContain("function codexHubServerName(threadId: string)");
  expect(source).toContain("const hadCodexHub = mcpHubGateway");
});

test("saving browser integration settings schedules a Codex global runtime refresh", () => {
  const start = source.indexOf("IPC_CHANNELS.browserSettingsSave");
  const end = source.indexOf("IPC_CHANNELS.notificationSettingsGet", start);
  const handler = source.slice(start, end);
  expect(handler).toContain("scheduleCodexGlobalRuntimeRefresh()");
});
