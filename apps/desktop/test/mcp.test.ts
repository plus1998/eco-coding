import { expect, test } from "bun:test";
import {
  buildMcpSdkConfig,
  filterMcpSdkConfigByAssignedServers,
  parseAllowedToolPatterns,
  parseMcpArgsList,
  sanitizeMcpServerName,
  serializeMcpArgsList,
  serializeMcpEnvEntries,
  validateMcpServerInput,
} from "../src/shared/mcp";

test("builds stdio MCP config with default tool wildcard", () => {
  const config = buildMcpSdkConfig([
    {
      id: "1",
      name: "github",
      transport: "stdio",
      enabled: true,
      command: "npx",
      argsJson: '["-y", "@modelcontextprotocol/server-github"]',
      envJson: '{"GITHUB_TOKEN":"x"}',
      headersJson: "{}",
      allowedTools: "",
      createdAt: "",
      updatedAt: "",
    },
  ]);

  expect(config.mcpServers.github).toEqual({
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-github"],
    env: { GITHUB_TOKEN: "x" },
  });
  expect(config.allowedTools).toEqual(["mcp__github__*"]);
});

test("builds http MCP config with explicit tool patterns", () => {
  const config = buildMcpSdkConfig([
    {
      id: "2",
      name: "docs",
      transport: "http",
      enabled: true,
      url: "https://example.com/mcp",
      argsJson: "[]",
      envJson: "{}",
      headersJson: '{"Authorization":"Bearer token"}',
      allowedTools: "mcp__docs__search",
      createdAt: "",
      updatedAt: "",
    },
  ]);

  expect(config.mcpServers.docs).toMatchObject({
    type: "http",
    url: "https://example.com/mcp",
    headers: { Authorization: "Bearer token" },
  });
  expect(config.allowedTools).toEqual(["mcp__docs__search"]);
});

test("validates MCP server input", () => {
  expect(() =>
    validateMcpServerInput({ name: "", transport: "stdio", enabled: true, command: "npx" }),
  ).toThrow();
  expect(() =>
    validateMcpServerInput({ name: "bad name", transport: "stdio", enabled: true, command: "npx" }),
  ).toThrow();
  expect(() => validateMcpServerInput({ name: "ok", transport: "http", enabled: true })).toThrow();
});

test("serializes form args and env for storage", () => {
  expect(serializeMcpArgsList(["-y", "pkg"])).toBe('["-y","pkg"]');
  expect(serializeMcpEnvEntries([{ key: "FOO", value: "bar" }])).toBe('{"FOO":"bar"}');
  expect(parseMcpArgsList('["-y","pkg"]')).toEqual(["-y", "pkg"]);
});

test("sanitizes server names for tool prefixes", () => {
  expect(sanitizeMcpServerName("GitHub API")).toBe("github-api");
  expect(parseAllowedToolPatterns("", "My Server")).toEqual(["mcp__my-server__*"]);
});

test("filterMcpSdkConfigByAssignedServers keeps only assigned servers", () => {
  const full = buildMcpSdkConfig([
    {
      id: "1",
      name: "github",
      transport: "stdio",
      enabled: true,
      command: "npx",
      argsJson: "[]",
      envJson: "{}",
      headersJson: "{}",
      allowedTools: "",
      createdAt: "",
      updatedAt: "",
    },
    {
      id: "2",
      name: "docs",
      transport: "http",
      enabled: true,
      url: "https://example.com/mcp",
      argsJson: "[]",
      envJson: "{}",
      headersJson: "{}",
      allowedTools: "mcp__docs__search",
      createdAt: "",
      updatedAt: "",
    },
  ]);

  expect(filterMcpSdkConfigByAssignedServers(full, [])).toEqual({
    mcpServers: {},
    allowedTools: [],
  });

  const githubOnly = filterMcpSdkConfigByAssignedServers(full, ["github"]);
  expect(Object.keys(githubOnly.mcpServers)).toEqual(["github"]);
  expect(githubOnly.allowedTools).toEqual(["mcp__github__*"]);

  const docsOnly = filterMcpSdkConfigByAssignedServers(full, ["docs"]);
  expect(Object.keys(docsOnly.mcpServers)).toEqual(["docs"]);
  expect(docsOnly.allowedTools).toEqual(["mcp__docs__search"]);
});
