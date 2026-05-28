import fs from "node:fs/promises";
import path from "node:path";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";
import {
  AGENT_ROLES,
  type AgentRole,
  type ModelSettingsSnapshot,
  type ProviderConfigInput,
  type ProviderConfigView,
  type RoleRouteConfig,
} from "../shared/ipc";

interface ProviderRow {
  id: string;
  name: string;
  base_url: string;
  api_key: string;
  default_model: string;
  enabled: number;
  created_at: string;
  updated_at: string;
}

interface RouteRow {
  role: AgentRole;
  provider_id: string;
  model_id: string;
}

export interface ProviderConfigSecret extends ProviderConfigView {
  apiKey: string;
}

const DEFAULT_PROVIDER_ID = "anthropic-compatible";
const DEFAULT_MODEL = "sonnet";

export async function createProviderStore(dbPath: string): Promise<ProviderStore> {
  await fs.mkdir(path.dirname(dbPath), { recursive: true });
  const sqlite = await import("node:sqlite");
  const store = new ProviderStore(new sqlite.DatabaseSync(dbPath));
  store.initialize();
  return store;
}

export class ProviderStore {
  constructor(private readonly db: DatabaseSyncType) {}

  initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS provider_configs (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        base_url TEXT NOT NULL,
        api_key TEXT NOT NULL,
        default_model TEXT NOT NULL,
        enabled INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS role_routes (
        role TEXT PRIMARY KEY,
        provider_id TEXT NOT NULL,
        model_id TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(provider_id) REFERENCES provider_configs(id)
      );
    `);

    if (this.listProviders().length === 0) {
      this.saveProvider({
        id: DEFAULT_PROVIDER_ID,
        name: "Anthropic compatible",
        baseUrl: "https://api.anthropic.com",
        apiKey: "",
        defaultModel: DEFAULT_MODEL,
        enabled: true,
      });
    }

    const routeRoles = new Set(this.listRoleRoutes().map((route) => route.role));
    for (const role of AGENT_ROLES) {
      if (!routeRoles.has(role)) {
        this.saveRoleRoute({
          role,
          providerId: DEFAULT_PROVIDER_ID,
          modelId: DEFAULT_MODEL,
        });
      }
    }
  }

  getSettings(): ModelSettingsSnapshot {
    return {
      providers: this.listProviders(),
      routes: this.listRoleRoutes(),
    };
  }

  listProviders(): ProviderConfigView[] {
    return this.listProviderRows().map(providerRowToView);
  }

  listProvidersWithSecrets(): ProviderConfigSecret[] {
    return this.listProviderRows().map((row) => ({
      ...providerRowToView(row),
      apiKey: row.api_key,
    }));
  }

  saveProvider(input: ProviderConfigInput): ProviderConfigView {
    validateProviderInput(input);
    const now = new Date().toISOString();
    const existing = input.id ? this.getProviderRow(input.id) : undefined;
    const id = input.id ?? createProviderId(input.name);
    const apiKey = input.apiKey && input.apiKey.length > 0 ? input.apiKey : (existing?.api_key ?? "");
    const createdAt = existing?.created_at ?? now;

    this.db
      .prepare(`
        INSERT INTO provider_configs (
          id, name, base_url, api_key, default_model, enabled, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          base_url = excluded.base_url,
          api_key = excluded.api_key,
          default_model = excluded.default_model,
          enabled = excluded.enabled,
          updated_at = excluded.updated_at
      `)
      .run(
        id,
        input.name.trim(),
        input.baseUrl.trim(),
        apiKey,
        input.defaultModel.trim(),
        input.enabled ? 1 : 0,
        createdAt,
        now,
      );

    return providerRowToView(this.getProviderRow(id) ?? fail(`Provider ${id} was not saved`));
  }

  listRoleRoutes(): RoleRouteConfig[] {
    return this.db
      .prepare("SELECT role, provider_id, model_id FROM role_routes ORDER BY role")
      .all()
      .map((row) => routeRowToConfig(row as unknown as RouteRow));
  }

  saveRoleRoutes(routes: RoleRouteConfig[]): RoleRouteConfig[] {
    for (const route of routes) {
      this.saveRoleRoute(route);
    }
    return this.listRoleRoutes();
  }

  private saveRoleRoute(route: RoleRouteConfig): void {
    if (!AGENT_ROLES.includes(route.role)) {
      throw new Error(`Unsupported role: ${route.role}`);
    }
    if (!this.getProviderRow(route.providerId)) {
      throw new Error(`Provider ${route.providerId} does not exist`);
    }
    if (!route.modelId.trim()) {
      throw new Error(`Model id is required for ${route.role}`);
    }

    this.db
      .prepare(`
        INSERT INTO role_routes (role, provider_id, model_id, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(role) DO UPDATE SET
          provider_id = excluded.provider_id,
          model_id = excluded.model_id,
          updated_at = excluded.updated_at
      `)
      .run(route.role, route.providerId, route.modelId.trim(), new Date().toISOString());
  }

  private listProviderRows(): ProviderRow[] {
    return this.db
      .prepare(`
        SELECT id, name, base_url, api_key, default_model, enabled, created_at, updated_at
        FROM provider_configs
        ORDER BY updated_at DESC, name ASC
      `)
      .all() as unknown as ProviderRow[];
  }

  private getProviderRow(id: string): ProviderRow | undefined {
    return this.db
      .prepare(`
        SELECT id, name, base_url, api_key, default_model, enabled, created_at, updated_at
        FROM provider_configs
        WHERE id = ?
      `)
      .get(id) as ProviderRow | undefined;
  }
}

function providerRowToView(row: ProviderRow): ProviderConfigView {
  const provider: ProviderConfigView = {
    id: row.id,
    name: row.name,
    baseUrl: row.base_url,
    defaultModel: row.default_model,
    enabled: row.enabled === 1,
    hasApiKey: row.api_key.length > 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  const apiKeyPreview = previewSecret(row.api_key);
  if (apiKeyPreview) provider.apiKeyPreview = apiKeyPreview;
  return provider;
}

function routeRowToConfig(row: RouteRow): RoleRouteConfig {
  return {
    role: row.role,
    providerId: row.provider_id,
    modelId: row.model_id,
  };
}

function validateProviderInput(input: ProviderConfigInput): void {
  if (!input.name.trim()) throw new Error("Provider name is required.");
  if (!input.baseUrl.trim().startsWith("http://") && !input.baseUrl.trim().startsWith("https://")) {
    throw new Error("Provider baseURL must start with http:// or https://.");
  }
  if (!input.defaultModel.trim()) throw new Error("Default model is required.");
}

function createProviderId(name: string): string {
  const suffix = Math.random().toString(36).slice(2, 8);
  const normalizedName = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  return `${normalizedName || "provider"}-${suffix}`;
}

function previewSecret(secret: string): string | undefined {
  if (!secret) return undefined;
  if (secret.length <= 8) return "saved";
  return `${secret.slice(0, 4)}...${secret.slice(-4)}`;
}

function fail(message: string): never {
  throw new Error(message);
}
