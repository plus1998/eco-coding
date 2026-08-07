import fs from "node:fs/promises";
import path from "node:path";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";
import type { ProxyBridgeSettingsSnapshot } from "../shared/ipc";

const PROXY_BRIDGE_SETTINGS_KEY = "proxy_bridge";
const MAX_UPSTREAM_USER_AGENT_LENGTH = 512;

export function defaultProxyBridgeSettings(): ProxyBridgeSettingsSnapshot {
  return {};
}

export async function createProxyBridgeSettingsStore(
  dbPath: string,
): Promise<ProxyBridgeSettingsStore> {
  await fs.mkdir(path.dirname(dbPath), { recursive: true });
  const sqlite = await import("node:sqlite");
  const store = new ProxyBridgeSettingsStore(new sqlite.DatabaseSync(dbPath));
  store.initialize();
  return store;
}

export class ProxyBridgeSettingsStore {
  constructor(private readonly db: DatabaseSyncType) {}

  initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS workflow_settings (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  }

  get(): ProxyBridgeSettingsSnapshot {
    const row = this.db
      .prepare(`SELECT value_json FROM workflow_settings WHERE key = ?`)
      .get(PROXY_BRIDGE_SETTINGS_KEY) as { value_json: string } | undefined;
    if (!row) {
      return defaultProxyBridgeSettings();
    }
    try {
      return normalizeProxyBridgeSettingsSnapshot(JSON.parse(row.value_json) as unknown);
    } catch {
      return defaultProxyBridgeSettings();
    }
  }

  save(snapshot: ProxyBridgeSettingsSnapshot): ProxyBridgeSettingsSnapshot {
    const normalized = normalizeProxyBridgeSettingsSnapshot(snapshot);
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO workflow_settings (key, value_json, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
      )
      .run(PROXY_BRIDGE_SETTINGS_KEY, JSON.stringify(normalized), now);
    return this.get();
  }
}

export function normalizeProxyBridgeSettingsSnapshot(
  value: unknown,
): ProxyBridgeSettingsSnapshot {
  if (!value || typeof value !== "object") {
    return defaultProxyBridgeSettings();
  }
  const record = value as Record<string, unknown>;
  const result: ProxyBridgeSettingsSnapshot = {};

  const rawUa =
    typeof record.upstreamUserAgent === "string" ? record.upstreamUserAgent.trim() : "";
  if (rawUa) {
    if (rawUa.includes("\r") || rawUa.includes("\n")) {
      throw new Error("上游 User-Agent 不能包含换行符。");
    }
    if (rawUa.length > MAX_UPSTREAM_USER_AGENT_LENGTH) {
      throw new Error(`上游 User-Agent 不能超过 ${MAX_UPSTREAM_USER_AGENT_LENGTH} 个字符。`);
    }
    result.upstreamUserAgent = rawUa;
  }

  const rawProxy =
    typeof record.upstreamProxyUrl === "string" ? record.upstreamProxyUrl.trim() : "";
  if (rawProxy) {
    if (rawProxy.includes("\r") || rawProxy.includes("\n")) {
      throw new Error("上游代理 URL 不能包含换行符。");
    }
    let url: URL;
    try {
      url = new URL(rawProxy);
    } catch {
      throw new Error(`无效的上游代理 URL: ${rawProxy}`);
    }
    const protocol = url.protocol.toLowerCase();
    if (!["http:", "https:", "socks5:", "socks:"].includes(protocol)) {
      throw new Error("代理仅支持 http://、https://、socks5:// 或 socks://");
    }
    if (!url.hostname) {
      throw new Error("上游代理 URL 缺少主机名。");
    }
    result.upstreamProxyUrl = rawProxy;
  }

  return result;
}

export function isProxyBridgeSettingsSnapshot(
  value: unknown,
): value is ProxyBridgeSettingsSnapshot {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (
    record.upstreamUserAgent !== undefined &&
    typeof record.upstreamUserAgent !== "string"
  ) {
    return false;
  }
  if (
    record.upstreamProxyUrl !== undefined &&
    typeof record.upstreamProxyUrl !== "string"
  ) {
    return false;
  }
  return true;
}

/** Resolved override for upstream requests; undefined means passthrough SDK UA. */
export function resolveUpstreamUserAgentOverride(
  settings: ProxyBridgeSettingsSnapshot,
): string | undefined {
  const trimmed = settings.upstreamUserAgent?.trim();
  return trimmed ? trimmed : undefined;
}
