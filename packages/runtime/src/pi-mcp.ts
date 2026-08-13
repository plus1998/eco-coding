import path from "node:path";
import { createMcpAdapter } from "../vendor/pi-mcp-adapter.js";

/**
 * Map Eco / Claude-SDK shaped MCP server entries into pi-mcp-adapter in-memory config.
 * Isolated snapshots only — never merge ambient .mcp.json / ~/.pi files.
 *
 * The npm package ships TypeScript source; Electron/Node cannot strip types under
 * node_modules. Eco loads the vendored JS build produced by
 * `scripts/bundle-pi-mcp-adapter.mjs` instead.
 */

export const PI_MCP_PROXY_TOOL_NAMES = ["mcp", "mcpScript"] as const;

export type PiMcpAdapterServerEntry = {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  url?: string;
  headers?: Record<string, string>;
  httpTransport?: "streamable-http" | "sse";
  lifecycle?: "lazy" | "eager" | "keep-alive" | "lazy-keep-alive";
  includeTools?: string[];
  disabled?: boolean;
};

export type PiMcpAdapterConfig = {
  mcpServers: Record<string, PiMcpAdapterServerEntry>;
};

/** Claude/Eco SDK entry → pi-mcp-adapter ServerEntry. Returns undefined when incomplete/unsupported. */
export function toPiMcpServerEntry(
  entry: unknown,
): PiMcpAdapterServerEntry | undefined {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    return undefined;
  }
  const record = entry as Record<string, unknown>;

  if (typeof record.command === "string" && record.command.trim()) {
    const args = Array.isArray(record.args)
      ? record.args.filter((value): value is string => typeof value === "string")
      : undefined;
    const env = stringRecord(record.env);
    const cwd = typeof record.cwd === "string" && record.cwd.trim() ? record.cwd.trim() : undefined;
    return {
      command: record.command.trim(),
      ...(args && args.length > 0 ? { args } : {}),
      ...(env && Object.keys(env).length > 0 ? { env } : {}),
      ...(cwd ? { cwd } : {}),
      lifecycle: "lazy",
    };
  }

  if (typeof record.url === "string" && record.url.trim()) {
    const headers = stringRecord(record.headers);
    const transportType =
      record.type === "sse" || record.httpTransport === "sse" ? "sse" : "http";
    return {
      url: record.url.trim(),
      ...(headers && Object.keys(headers).length > 0 ? { headers } : {}),
      ...(transportType === "sse" ? { httpTransport: "sse" as const } : {}),
      lifecycle: "lazy",
    };
  }

  // socket-only / unknown — not mapped from Eco McpStore today
  return undefined;
}

/** Convert Eco session mcpServers map into an isolated pi-mcp-adapter config snapshot. */
export function toPiMcpAdapterConfig(
  mcpServers: Record<string, unknown> | undefined,
): PiMcpAdapterConfig {
  const next: Record<string, PiMcpAdapterServerEntry> = {};
  if (!mcpServers) {
    return { mcpServers: next };
  }
  for (const [name, entry] of Object.entries(mcpServers)) {
    const key = name.trim();
    if (!key) continue;
    const mapped = toPiMcpServerEntry(entry);
    if (mapped) {
      next[key] = mapped;
    }
  }
  return { mcpServers: next };
}

/** Env keys that must not participate in PI session identity. */
export function isPiMcpSecretEnvKey(key: string): boolean {
  const k = key.trim();
  if (!k.startsWith("ECO_")) {
    return false;
  }
  return (
    k.endsWith("AUTH_TOKEN") ||
    k.endsWith("SECRET") ||
    k.endsWith("_TOKEN")
  );
}

function stripSecretEnv(
  env: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!env) {
    return undefined;
  }
  const next: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (isPiMcpSecretEnvKey(key)) {
      continue;
    }
    next[key] = value;
  }
  return Object.keys(next).length > 0 ? next : undefined;
}

function sanitizePiMcpServerEntry(entry: PiMcpAdapterServerEntry): PiMcpAdapterServerEntry {
  const env = stripSecretEnv(entry.env);
  return {
    ...entry,
    ...(env ? { env } : { env: undefined }),
  };
}

/** Stable fingerprint for session identity (order-independent; secrets stripped). */
export function fingerprintPiMcpServers(
  mcpServers: Record<string, unknown> | undefined,
): string {
  const config = toPiMcpAdapterConfig(mcpServers);
  const keys = Object.keys(config.mcpServers).sort((a, b) => a.localeCompare(b));
  if (keys.length === 0) {
    return "";
  }
  const payload = keys.map((key) => {
    const entry = config.mcpServers[key]!;
    const sanitized = sanitizePiMcpServerEntry(entry);
    const { env: _omitIfEmpty, ...rest } = sanitized;
    const out: PiMcpAdapterServerEntry = { ...rest };
    if (sanitized.env) {
      out.env = sanitized.env;
    }
    return [key, out] as const;
  });
  return JSON.stringify(payload);
}

/**
 * Re-strip secrets from a previously stored fingerprint string so upgrades
 * can resume sessions whose metadata still embedded auth tokens.
 */
export function canonicalizePiMcpFingerprint(stored: string): string {
  const raw = stored.trim();
  if (!raw) {
    return "";
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return raw;
    }
    const asRecord: Record<string, unknown> = {};
    for (const item of parsed) {
      if (!Array.isArray(item) || item.length < 2) {
        return raw;
      }
      const name = item[0];
      if (typeof name !== "string" || !name.trim()) {
        return raw;
      }
      asRecord[name] = item[1];
    }
    return fingerprintPiMcpServers(asRecord);
  } catch {
    return raw;
  }
}

export function piMcpToolAllowlist(hasMcpServers: boolean): string[] {
  const base = ["read", "bash", "edit", "write"];
  if (!hasMcpServers) {
    return base;
  }
  return [...base, ...PI_MCP_PROXY_TOOL_NAMES];
}

/**
 * Build a pi-mcp-adapter ExtensionFactory from an isolated in-memory config.
 * Returns undefined when there are no servers (skip loading the extension).
 *
 * When `agentDir` is set, point `PI_CODING_AGENT_DIR` at Eco's per-thread agent
 * dir so the adapter writes mcp-cache under Eco data instead of `~/.pi`.
 */
export async function createPiMcpExtensionFactory(
  mcpServers: Record<string, unknown> | undefined,
  options?: { agentDir?: string },
): Promise<((pi: unknown) => void | Promise<void>) | undefined> {
  const config = toPiMcpAdapterConfig(mcpServers);
  if (Object.keys(config.mcpServers).length === 0) {
    return undefined;
  }
  if (typeof createMcpAdapter !== "function") {
    throw new Error(
      "Vendored pi-mcp-adapter is missing createMcpAdapter. Run: bun run --cwd packages/runtime bundle:pi-mcp-adapter",
    );
  }
  const agentDir = options?.agentDir?.trim();
  if (agentDir) {
    process.env.PI_CODING_AGENT_DIR = path.resolve(agentDir);
  }
  return createMcpAdapter({
    config: {
      mcpServers: config.mcpServers,
      settings: {
        // Headless Eco sessions: no interactive OAuth panels / ambient file writes.
        hostConfigDiscovery: "off",
        scriptMode: true,
        samplingAutoApprove: true,
      },
    },
  });
}

function stringRecord(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry === "string") {
      out[key] = entry;
    }
  }
  return out;
}
