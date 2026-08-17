import { expect, test } from "bun:test";
import { toAcpMcpServer, toAcpMcpServers } from "../src/acp-mcp.js";

test("toAcpMcpServers maps Eco stdio entries to ACP env-variable arrays", () => {
  expect(
    toAcpMcpServers({
      github: {
        command: "uvx",
        args: ["mcp-github"],
        env: { TOKEN: "abc", PATH: "/bin" },
        cwd: "/tmp/ws",
        alwaysLoad: true,
        timeout: 60_000,
      },
    }),
  ).toEqual([
    {
      type: "stdio",
      name: "github",
      command: "uvx",
      args: ["mcp-github"],
      env: [
        { name: "TOKEN", value: "abc" },
        { name: "PATH", value: "/bin" },
      ],
      cwd: "/tmp/ws",
    },
  ]);
});

test("toAcpMcpServers maps http and sse; streamable-http becomes http", () => {
  expect(
    toAcpMcpServers({
      docs: { type: "http", url: "https://example.com/mcp", headers: { Authorization: "Bearer x" } },
      events: { type: "sse", url: "https://example.com/sse" },
      a11y: { type: "streamable-http", url: "http://127.0.0.1:3000/mcp" },
    }),
  ).toEqual([
    {
      type: "http",
      name: "docs",
      url: "https://example.com/mcp",
      headers: [{ name: "Authorization", value: "Bearer x" }],
    },
    { type: "sse", name: "events", url: "https://example.com/sse", headers: [] },
    { type: "http", name: "a11y", url: "http://127.0.0.1:3000/mcp", headers: [] },
  ]);
});

test("toAcpMcpServers keeps ACP env arrays and defaults missing args/env", () => {
  expect(
    toAcpMcpServers({
      shell: {
        command: "/bin/mcp",
        env: [{ name: "HOME", value: "/tmp" }],
      },
    }),
  ).toEqual([
    {
      type: "stdio",
      name: "shell",
      command: "/bin/mcp",
      args: [],
      env: [{ name: "HOME", value: "/tmp" }],
    },
  ]);
});

test("toAcpMcpServers returns [] for empty or missing maps", () => {
  expect(toAcpMcpServers(undefined)).toEqual([]);
  expect(toAcpMcpServers({})).toEqual([]);
});

test("toAcpMcpServers throws listing servers that cannot be mapped", () => {
  expect(() =>
    toAcpMcpServers({
      github: { command: "uvx" },
      broken: { type: "stdio" },
      also: { headers: { A: "1" } },
    }),
  ).toThrow(/broken, also/);
});

test("toAcpMcpServer returns undefined for non-objects", () => {
  expect(toAcpMcpServer("x", null)).toBeUndefined();
  expect(toAcpMcpServer("x", "stdio")).toBeUndefined();
});
