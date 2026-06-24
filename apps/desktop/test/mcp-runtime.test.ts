import { expect, test } from "bun:test";
import { buildMcpSdkConfig } from "../src/shared/mcp";
import { prepareMcpSdkConfigForRuntime } from "../src/main/mcp-runtime";

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
