import { expect, test } from "bun:test";
import { prepareCodexGlobalMcpServerPool, prepareMcpSdkConfigForRuntime } from "../src/main/mcp-runtime";
import { buildMcpSdkConfig } from "../src/shared/mcp";

test("prepareMcpSdkConfigForRuntime resolves stdio command and merges spawn env", () => {
  const config = buildMcpSdkConfig([
    {
      id: "1",
      name: "mongo",
      transport: "stdio",
      enabled: true,
      command: "npx",
      argsJson: '["-y", "mongodb-mcp-server@latest"]',
      envJson: '{"MDB_MCP_CONNECTION_STRING":"mongodb://localhost:27017"}',
      headersJson: "{}",
      allowedTools: "",
      createdAt: "",
      updatedAt: "",
    },
  ]);

  const prepared = prepareMcpSdkConfigForRuntime(config);
  const mongo = prepared.mcpServers.mongo as Record<string, unknown>;
  expect(mongo.type).toBe("stdio");
  expect(mongo.alwaysLoad).toBe(true);
  expect(mongo.timeout).toBe(60_000);
  expect(typeof mongo.command).toBe("string");
  expect((mongo.command as string).length).toBeGreaterThan(0);
  const env = mongo.env as Record<string, string>;
  expect(env.MDB_MCP_CONNECTION_STRING).toBe("mongodb://localhost:27017");
  expect(env.PATH?.length ?? 0).toBeGreaterThan(0);
});

test("prepareMcpSdkConfigForRuntime enriches http MCP servers", () => {
  const config = buildMcpSdkConfig([
    {
      id: "2",
      name: "docs",
      transport: "http",
      enabled: true,
      url: "https://example.com/mcp",
      argsJson: "[]",
      envJson: "{}",
      headersJson: "{}",
      allowedTools: "",
      createdAt: "",
      updatedAt: "",
    },
  ]);

  const prepared = prepareMcpSdkConfigForRuntime(config);
  const docs = prepared.mcpServers.docs as Record<string, unknown>;
  expect(docs.type).toBe("http");
  expect(docs.alwaysLoad).toBe(true);
  expect(docs.timeout).toBe(60_000);
});

test("global Codex MCP pool includes built-ins and lets trusted definitions win", async () => {
  const prepared = await prepareCodexGlobalMcpServerPool({
    configuredServers: [
      { name: "docs", transport: "http", url: "https://example.com/mcp" },
      {
        name: "eco_agent_browser",
        transport: "stdio",
        command: process.execPath,
        env: { SOURCE: "user" },
      },
    ],
    builtinServerResolvers: [
      () => ({
        name: "eco_agent_browser",
        transport: "stdio",
        command: process.execPath,
        env: { SOURCE: "builtin" },
      }),
      async () => ({
        name: "eco_image_generation",
        transport: "stdio",
        command: process.execPath,
      }),
    ],
  });

  expect(prepared.map((server) => server.name)).toEqual([
    "docs",
    "eco_agent_browser",
    "eco_image_generation",
  ]);
  expect(prepared.find((server) => server.name === "eco_agent_browser")?.env?.SOURCE).toBe("builtin");
});
