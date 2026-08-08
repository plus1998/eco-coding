import { expect, test } from "bun:test";
import {
  countEnabledMcpServers,
  deriveMcpServersEnabled,
  listEnabledGlobalMcpServerKeys,
  normalizeMcpServersEnabled,
  resolveEnabledMcpServerKeys,
} from "../src/shared/composer-mcp";
import type { McpServerConfigView } from "../src/shared/ipc";

const servers: McpServerConfigView[] = [
  {
    id: "1",
    name: "mongo",
    transport: "stdio",
    enabled: true,
    command: "npx",
    args: ["-y", "mongodb-mcp-server@latest"],
    env: {},
    updatedAt: "2020-01-01T00:00:00.000Z",
  },
  {
    id: "2",
    name: "browser",
    transport: "stdio",
    enabled: true,
    command: "npx",
    args: ["-y", "browser-mcp"],
    env: {},
    updatedAt: "2020-01-01T00:00:00.000Z",
  },
  {
    id: "3",
    name: "disabled",
    transport: "stdio",
    enabled: false,
    command: "npx",
    args: [],
    env: {},
    updatedAt: "2020-01-01T00:00:00.000Z",
  },
];

test("listEnabledGlobalMcpServerKeys returns only enabled global servers", () => {
  expect(listEnabledGlobalMcpServerKeys(servers)).toEqual(["mongo", "browser"]);
});

test("deriveMcpServersEnabled prefers existing over remembered", () => {
  const available = ["mongo", "browser"];
  expect(
    deriveMcpServersEnabled(available, {
      remembered: { mongo: false, browser: true },
      existing: { mongo: true },
    }),
  ).toEqual({ mongo: true, browser: true });
});

test("deriveMcpServersEnabled defaults servers off without orchestration assignment", () => {
  const available = ["mongo", "browser"];
  expect(
    deriveMcpServersEnabled(available, {
      remembered: { browser: true },
    }),
  ).toEqual({ mongo: false, browser: true });
  expect(deriveMcpServersEnabled(available)).toEqual({ mongo: false, browser: false });
});

test("resolveEnabledMcpServerKeys and countEnabledMcpServers", () => {
  const settings = { mongo: true, browser: false };
  expect(resolveEnabledMcpServerKeys(settings)).toEqual(["mongo"]);
  expect(countEnabledMcpServers(settings)).toBe(1);
});

test("normalizeMcpServersEnabled sanitizes keys and drops invalid entries", () => {
  expect(normalizeMcpServersEnabled({ " Mongo ": true, browser: "yes" })).toEqual({
    mongo: true,
  });
  expect(normalizeMcpServersEnabled(null)).toBeUndefined();
});
