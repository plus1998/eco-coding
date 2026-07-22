import fs from "node:fs/promises";
import path from "node:path";
import {
  buildCodexGatewayModelAlias as buildSharedCodexGatewayModelAlias,
  CODEX_GATEWAY_MODEL_ALIAS_SEPARATOR,
  parseCodexGatewayModelAlias as parseSharedCodexGatewayModelAlias,
  type CodexGatewayApiCompat,
  type ParsedCodexGatewayModelAlias,
} from "../../shared/src";

export const DEFAULT_ECO_GATEWAY_PORT = 18_765;
/** Codex stream idle timeout — local models may pause a long time before first token. */
export const DEFAULT_CODEX_STREAM_IDLE_TIMEOUT_MS = 900_000;
/** Avoid hammering free/local upstreams when a slow request is still in flight. */
export const DEFAULT_CODEX_REQUEST_MAX_RETRIES = 0;

export function resolveCodexStreamIdleTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.ECO_CODEX_STREAM_IDLE_TIMEOUT_MS?.trim();
  if (!raw) {
    return DEFAULT_CODEX_STREAM_IDLE_TIMEOUT_MS;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid ECO_CODEX_STREAM_IDLE_TIMEOUT_MS: ${raw}`);
  }
  return parsed;
}

export interface EcoProviderForCodexConfig {
  id: string;
  name: string;
  enabled: boolean;
  apiCompat?: "anthropic" | "openai_responses" | "openai_chat_completions";
  compactionMode?: "codex-local" | "responses-native";
}

export interface CodexAgentRoleForConfigSync {
  roleId: string;
  description: string;
  configFile: string;
}

/** Codex `config.toml` `[mcp_servers.*]` entry (stdio or streamable HTTP only). */
export interface CodexMcpServerForConfigSync {
  name: string;
  transport: "stdio" | "http";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  httpHeaders?: Record<string, string>;
  /** Tool names without `mcp__<server>__` prefix; omit = all tools from the server. */
  enabledTools?: string[];
  /**
   * Codex default is 10s — too short for `npx -y …` cold starts.
   * Eco writes 60s for stdio servers prepared for runtime.
   */
  startupTimeoutSec?: number;
}

export interface SyncCodexConfigFromEcoProvidersInput {
  ecoDataDir: string;
  providers: readonly EcoProviderForCodexConfig[];
  /** Keep global multi-agent feature/hook support installed; role definitions remain thread-scoped. */
  enableMultiAgent?: boolean;
  agentRoles?: readonly CodexAgentRoleForConfigSync[];
  /** Thread/composer-selected MCP servers; omitted or empty = no MCP in config.toml. */
  mcpServers?: readonly CodexMcpServerForConfigSync[];
  gatewayPort?: number;
  gatewayBaseUrl?: string;
  /**
   * Absolute path to Eco's formal model catalog (`eco-model-catalog.json`).
   * When set, written as `model_catalog_json` so gateway aliases receive freeform apply_patch.
   */
  modelCatalogJsonPath?: string;
}

export interface SyncCodexConfigResult {
  codexHomeDir: string;
  configPath: string;
  gatewayBaseUrl: string;
  providerSlugs: string[];
  mcpServerNames: string[];
  defaultProviderSlug?: string;
  modelCatalogJsonPath?: string;
}

export function resolveEcoGatewayPort(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.ECO_GATEWAY_PORT?.trim();
  if (!raw) {
    return DEFAULT_ECO_GATEWAY_PORT;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid ECO_GATEWAY_PORT: ${raw}`);
  }
  return parsed;
}

export function resolveEcoGatewayBaseUrl(port?: number, env: NodeJS.ProcessEnv = process.env): string {
  const resolvedPort = port ?? resolveEcoGatewayPort(env);
  return `http://127.0.0.1:${resolvedPort}/v1`;
}

export function resolveCodexHomeDir(ecoDataDir: string): string {
  return path.join(ecoDataDir, "codex");
}

export function buildCodexModelProviderSlug(providerId: string): string {
  const trimmed = providerId.trim();
  if (!trimmed) {
    throw new Error("Provider id is required for Codex model provider slug");
  }
  return `eco_${trimmed}`;
}

export { CODEX_GATEWAY_MODEL_ALIAS_SEPARATOR };

/**
 * Provider-scoped model id for Codex → eco-gateway HTTP routing.
 * Avoids collisions when multiple providers expose the same upstream model name.
 */
export function buildCodexGatewayModelAlias(
  providerId: string,
  upstreamModelId: string,
  apiCompat?: CodexGatewayApiCompat,
): string {
  return buildSharedCodexGatewayModelAlias(providerId, upstreamModelId, apiCompat);
}

export function parseCodexGatewayModelAlias(
  requestedModel: string,
): ParsedCodexGatewayModelAlias | undefined {
  return parseSharedCodexGatewayModelAlias(requestedModel);
}

export function buildCodexConfigToml(input: SyncCodexConfigFromEcoProvidersInput): string {
  const gatewayBaseUrl = input.gatewayBaseUrl ?? resolveEcoGatewayBaseUrl(input.gatewayPort);
  const enabledProviders = input.providers.filter((provider) => provider.enabled);
  const defaultProvider = enabledProviders[0];
  const agentRoles = uniqueAgentRoles(input.agentRoles ?? []);
  const enableMultiAgent = input.enableMultiAgent === true || agentRoles.length > 0;
  const lines = [
    "# Generated by Eco Coding. Upstream API keys live in ProviderStore / eco-gateway only.",
    "",
    // Gateway aliases are absent from Codex's built-in model catalog, whose
    // fallback disables summaries. Request them explicitly so reasoning reaches Feed.
    'model_reasoning_summary = "detailed"',
    "",
  ];

  const modelCatalogJsonPath = input.modelCatalogJsonPath?.trim();
  if (modelCatalogJsonPath) {
    if (!path.isAbsolute(modelCatalogJsonPath)) {
      throw new Error(
        `modelCatalogJsonPath must be an absolute path, received: ${modelCatalogJsonPath}`,
      );
    }
    // Formal Eco catalog with freeform apply_patch aliases for eco_route_v1… models.
    lines.push(`model_catalog_json = ${tomlString(modelCatalogJsonPath)}`, "");
  }

  if (defaultProvider) {
    lines.push(`model_provider = "${buildCodexModelProviderSlug(defaultProvider.id)}"`, "");
  }

  // Role definitions are thread-scoped via thread/start.config and
  // thread/resume.config. Keeping them out of global config prevents one
  // concurrently prepared Profile from changing another thread's future spawn.
  if (enableMultiAgent) {
    lines.push(
      "[features]",
      "multi_agent = true",
      "hooks = true",
      "",
      "[agents]",
      "max_threads = 16",
      "max_depth = 1",
      "",
    );
  }

  const streamIdleTimeoutMs = resolveCodexStreamIdleTimeoutMs();
  for (const provider of enabledProviders) {
    const slug = buildCodexModelProviderSlug(provider.id);
    lines.push(
      `[model_providers.${slug}]`,
      `name = ${tomlString(resolveCodexModelProviderName(provider, slug))}`,
      `base_url = ${tomlString(gatewayBaseUrl)}`,
      'wire_api = "responses"',
      // Local / slow models often emit no bytes for minutes during prefill.
      `stream_idle_timeout_ms = ${streamIdleTimeoutMs}`,
      `request_max_retries = ${DEFAULT_CODEX_REQUEST_MAX_RETRIES}`,
      "",
    );
  }

  for (const server of uniqueMcpServers(input.mcpServers ?? [])) {
    lines.push(...buildCodexMcpServerTomlLines(server));
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

function resolveCodexModelProviderName(provider: EcoProviderForCodexConfig, slug: string): string {
  if (provider.compactionMode === "responses-native") {
    if (provider.apiCompat !== "openai_responses") {
      throw new Error(
        `Provider "${provider.id}" can use responses-native compaction only with apiCompat=openai_responses.`,
      );
    }
    // Codex 0.142.5 selects remote compaction only for providers named exactly "OpenAI".
    return "OpenAI";
  }
  return `Eco Gateway (${slug})`;
}

export async function syncCodexConfigFromEcoProviders(
  input: SyncCodexConfigFromEcoProvidersInput,
): Promise<SyncCodexConfigResult> {
  const codexHomeDir = resolveCodexHomeDir(input.ecoDataDir);
  const configPath = path.join(codexHomeDir, "config.toml");
  const gatewayBaseUrl = input.gatewayBaseUrl ?? resolveEcoGatewayBaseUrl(input.gatewayPort);
  const enabledProviders = input.providers.filter((provider) => provider.enabled);
  const providerSlugs = enabledProviders.map((provider) => buildCodexModelProviderSlug(provider.id));
  const mcpServers = uniqueMcpServers(input.mcpServers ?? []);
  const configToml = buildCodexConfigToml({ ...input, gatewayBaseUrl, mcpServers });

  await fs.mkdir(codexHomeDir, { recursive: true });
  await fs.writeFile(configPath, configToml, "utf8");

  // When Profile agents exist, install PreToolUse hook so spawn_agent always uses
  // fork_turns=none (agent model from agents/*.toml) without teaching the main agent.
  // Also persist hooks.state trusted_hash — untrusted user hooks are skipped by Codex.
  // Dynamic import keeps node:crypto out of the renderer bundle.
  if (input.enableMultiAgent === true || (input.agentRoles ?? []).length > 0) {
    const { syncCodexSpawnAgentHook } = await import("./codex-spawn-agent-hook.js");
    const hook = await syncCodexSpawnAgentHook(codexHomeDir);
    await fs.appendFile(configPath, hook.trustTomlBlock, "utf8");
  }

  const modelCatalogJsonPath = input.modelCatalogJsonPath?.trim() || undefined;
  return {
    codexHomeDir,
    configPath,
    gatewayBaseUrl,
    providerSlugs,
    mcpServerNames: mcpServers.map((server) => server.name),
    ...(providerSlugs[0] ? { defaultProviderSlug: providerSlugs[0] } : {}),
    ...(modelCatalogJsonPath ? { modelCatalogJsonPath } : {}),
  };
}

export function codexConfigContainsUpstreamSecret(
  configToml: string,
  secrets: readonly string[],
): string | undefined {
  for (const secret of secrets) {
    const trimmed = secret.trim();
    if (!trimmed) {
      continue;
    }
    if (configToml.includes(trimmed)) {
      return trimmed;
    }
  }
  return undefined;
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

function tomlStringArray(values: readonly string[]): string {
  return `[${values.map((value) => tomlString(value)).join(", ")}]`;
}

function tomlInlineTable(entries: Record<string, string>): string {
  const parts = Object.entries(entries).map(([key, value]) => `${tomlString(key)} = ${tomlString(value)}`);
  return `{ ${parts.join(", ")} }`;
}

export function buildCodexMcpServerTomlLines(server: CodexMcpServerForConfigSync): string[] {
  const name = server.name.trim();
  if (!name) {
    throw new Error("Codex MCP server name is required.");
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
    throw new Error(`Invalid Codex MCP server name: ${name}`);
  }

  const lines: string[] = [`[mcp_servers.${name}]`];
  if (server.transport === "stdio") {
    const command = server.command?.trim();
    if (!command) {
      throw new Error(`Codex MCP server "${name}" requires a stdio command.`);
    }
    lines.push(`command = ${tomlString(command)}`);
    if (server.args && server.args.length > 0) {
      lines.push(`args = ${tomlStringArray(server.args)}`);
    }
  } else if (server.transport === "http") {
    const url = server.url?.trim();
    if (!url) {
      throw new Error(`Codex MCP server "${name}" requires an HTTP URL.`);
    }
    lines.push(`url = ${tomlString(url)}`);
    if (server.httpHeaders && Object.keys(server.httpHeaders).length > 0) {
      lines.push(`http_headers = ${tomlInlineTable(server.httpHeaders)}`);
    }
  } else {
    throw new Error(`Unsupported Codex MCP transport for "${name}".`);
  }

  if (server.enabledTools && server.enabledTools.length > 0) {
    lines.push(`enabled_tools = ${tomlStringArray(server.enabledTools)}`);
  }
  if (
    typeof server.startupTimeoutSec === "number" &&
    Number.isFinite(server.startupTimeoutSec) &&
    server.startupTimeoutSec > 0
  ) {
    lines.push(`startup_timeout_sec = ${Math.ceil(server.startupTimeoutSec)}`);
  }
  lines.push("enabled = true", "");

  if (server.transport === "stdio" && server.env && Object.keys(server.env).length > 0) {
    lines.push(`[mcp_servers.${name}.env]`);
    for (const [key, value] of Object.entries(server.env)) {
      const envKey = key.trim();
      if (!envKey) {
        continue;
      }
      lines.push(`${envKey} = ${tomlString(value)}`);
    }
    lines.push("");
  }

  return lines;
}

function uniqueAgentRoles(roles: readonly CodexAgentRoleForConfigSync[]): CodexAgentRoleForConfigSync[] {
  const seen = new Set<string>();
  const result: CodexAgentRoleForConfigSync[] = [];
  for (const role of roles) {
    const roleId = role.roleId.trim();
    if (!roleId || seen.has(roleId)) {
      continue;
    }
    seen.add(roleId);
    result.push({
      roleId,
      description: role.description,
      configFile: role.configFile,
    });
  }
  return result;
}

function uniqueMcpServers(servers: readonly CodexMcpServerForConfigSync[]): CodexMcpServerForConfigSync[] {
  const seen = new Set<string>();
  const result: CodexMcpServerForConfigSync[] = [];
  for (const server of servers) {
    const name = server.name.trim();
    if (!name || seen.has(name)) {
      continue;
    }
    seen.add(name);
    result.push({ ...server, name });
  }
  return result;
}
