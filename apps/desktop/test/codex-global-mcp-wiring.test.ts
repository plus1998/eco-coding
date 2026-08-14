import { expect, test } from "bun:test";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../src/main/index.ts", import.meta.url), "utf8");

test("Codex global MCP runtime uses the pool that includes built-in integrations", () => {
  expect(source).toContain("listGlobalMcpServers: resolveCodexGlobalMcpServers");
  expect(source).toContain("requireBrowserHost().resolveGlobalAgentBrowserMcpServer()");
  expect(source).toContain("imageGenerationGateway.resolveGlobalCodexServer()");
  expect(source).toContain("imageViewGateway.resolveGlobalCodexServer()");
  expect(source).toMatch(
    /resolveMcpServers:\s*async \(\) => \{\s*const globalPool = await resolveCodexGlobalMcpServers\(\)/,
  );
});

test("saving browser integration settings schedules a Codex global runtime refresh", () => {
  const start = source.indexOf("IPC_CHANNELS.browserSettingsSave");
  const end = source.indexOf("IPC_CHANNELS.notificationSettingsGet", start);
  const handler = source.slice(start, end);
  expect(handler).toContain("scheduleCodexGlobalRuntimeRefresh()");
});
