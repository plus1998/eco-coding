import type { CodexMcpServerForConfigSync } from "@eco/runtime";
import type { McpSdkConfig } from "../shared/mcp";
import { resolveCommandExecutable, toSpawnEnv } from "./resolve-command-executable";

const DEFAULT_MCP_CONNECT_TIMEOUT_MS = 60_000;
const DEFAULT_CODEX_MCP_STARTUP_TIMEOUT_SEC = 60;

export function prepareMcpSdkConfigForRuntime(config: McpSdkConfig): McpSdkConfig {
  const mcpServers: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(config.mcpServers)) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      continue;
    }
    mcpServers[key] = prepareMcpServerEntryForRuntime(entry as Record<string, unknown>);
  }
  return { ...config, mcpServers };
}

export function prepareCodexMcpServersForRuntime(
  servers: readonly CodexMcpServerForConfigSync[],
): CodexMcpServerForConfigSync[] {
  return servers.map((server) => {
    if (server.transport !== "stdio") {
      return {
        ...server,
        startupTimeoutSec: server.startupTimeoutSec ?? DEFAULT_CODEX_MCP_STARTUP_TIMEOUT_SEC,
      };
    }
    const spawnEnv = toSpawnEnv();
    return {
      ...server,
      ...(server.command?.trim() ? { command: resolveCommandExecutable(server.command.trim()) } : {}),
      env: {
        PATH: spawnEnv.PATH ?? spawnEnv.Path ?? "",
        ...(spawnEnv.HOME ? { HOME: spawnEnv.HOME } : {}),
        ...(server.env ?? {}),
      },
      startupTimeoutSec: server.startupTimeoutSec ?? DEFAULT_CODEX_MCP_STARTUP_TIMEOUT_SEC,
    };
  });
}

export async function prepareCodexGlobalMcpServerPool(input: {
  configuredServers: readonly CodexMcpServerForConfigSync[];
  builtinServerResolvers: readonly (() =>
    | CodexMcpServerForConfigSync
    | undefined
    | Promise<CodexMcpServerForConfigSync | undefined>)[];
}): Promise<CodexMcpServerForConfigSync[]> {
  const builtins = (await Promise.all(input.builtinServerResolvers.map((resolve) => resolve()))).filter(
    (server): server is CodexMcpServerForConfigSync => Boolean(server),
  );
  const builtinNames = new Set(builtins.map((server) => server.name.trim()));
  return prepareCodexMcpServersForRuntime([
    ...input.configuredServers.filter((server) => !builtinNames.has(server.name.trim())),
    ...builtins,
  ]);
}

function prepareMcpServerEntryForRuntime(entry: Record<string, unknown>): Record<string, unknown> {
  const prepared: Record<string, unknown> = { ...entry };
  const transportType = typeof prepared.type === "string" ? prepared.type : undefined;

  if (typeof prepared.command === "string" && prepared.command.trim()) {
    prepared.type = transportType ?? "stdio";
    prepared.command = resolveCommandExecutable(prepared.command.trim());
    const customEnv =
      prepared.env && typeof prepared.env === "object" && !Array.isArray(prepared.env)
        ? Object.fromEntries(
            Object.entries(prepared.env).filter(([, value]) => typeof value === "string") as Array<
              [string, string]
            >,
          )
        : {};
    prepared.env = { ...toSpawnEnv(), ...customEnv };
    prepared.alwaysLoad = prepared.alwaysLoad ?? true;
    prepared.timeout = prepared.timeout ?? DEFAULT_MCP_CONNECT_TIMEOUT_MS;
    return prepared;
  }

  if (typeof prepared.url === "string" && prepared.url.trim()) {
    prepared.type = transportType ?? "http";
    prepared.alwaysLoad = prepared.alwaysLoad ?? true;
    prepared.timeout = prepared.timeout ?? DEFAULT_MCP_CONNECT_TIMEOUT_MS;
  }

  return prepared;
}
