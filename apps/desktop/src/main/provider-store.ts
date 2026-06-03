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
  type RouteManualSpec,
  type RouteProfileInput,
  type RouteProfileView,
  type ThinkingEffort,
} from "../shared/ipc";
import { normalizeUpstreamApiCompat, type UpstreamApiCompat } from "../shared/api-compat";
import { normalizeRequestPath, splitBaseUrlAndRequestPath } from "./provider-models";

interface ProviderRow {
  id: string;
  name: string;
  base_url: string;
  request_path: string;
  api_compat: string;
  api_key: string;
  default_model: string;
  enabled: number;
  created_at: string;
  updated_at: string;
}

interface RouteProfileRow {
  id: string;
  name: string;
  is_active: number;
  created_at: string;
  updated_at: string;
}

interface RouteRow {
  profile_id: string;
  role: AgentRole;
  provider_id: string;
  model_id: string;
  api_compat: string | null;
  thinking_effort: string | null;
  models_dev_provider_key: string | null;
  models_dev_model_id: string | null;
  manual_context_tokens: number | null;
  manual_input_per_m: number | null;
  manual_output_per_m: number | null;
  manual_cache_read_per_m: number | null;
  manual_cache_write_per_m: number | null;
}

interface LegacyRouteRow {
  role: AgentRole;
  provider_id: string;
  model_id: string;
  thinking_effort: string | null;
}

export interface ProviderConfigSecret extends ProviderConfigView {
  apiKey: string;
}

const DEFAULT_ROUTE_PROFILE_ID = "default";


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

      CREATE TABLE IF NOT EXISTS route_profiles (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);

    this.migrateProviderRequestPath();
    this.migrateRoleRoutesToProfiles();
    this.migrateRoleRoutesThinkingEffort();
    this.migrateRoleRoutesModelsDevMapping();
    this.migrateRoleRoutesManualSpec();
    this.migrateProviderApiCompat();
    this.migrateRoleRoutesApiCompat();
    this.migrateLegacyOpenaiApiCompatValues();
  }

  getSettings(): ModelSettingsSnapshot {
    return {
      providers: this.listProviders(),
      routeProfiles: this.listRouteProfiles(),
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

  getProviderWithSecret(id: string): ProviderConfigSecret | undefined {
    const row = this.getProviderRow(id);
    if (!row) {
      return undefined;
    }
    return {
      ...providerRowToView(row),
      apiKey: row.api_key,
    };
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
          id, name, base_url, request_path, api_compat, api_key, default_model, enabled, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          base_url = excluded.base_url,
          request_path = excluded.request_path,
          api_compat = excluded.api_compat,
          api_key = excluded.api_key,
          default_model = excluded.default_model,
          enabled = excluded.enabled,
          updated_at = excluded.updated_at
      `)
      .run(
        id,
        input.name.trim(),
        input.baseUrl.trim(),
        normalizeRequestPath(input.requestPath),
        normalizeUpstreamApiCompat(input.apiCompat ?? existing?.api_compat),
        apiKey,
        input.defaultModel.trim(),
        input.enabled ? 1 : 0,
        createdAt,
        now,
      );

    return providerRowToView(this.getProviderRow(id) ?? fail(`Provider ${id} was not saved`));
  }

  deleteProvider(id: string): void {
    const providers = this.listProviderRows();
    if (providers.length <= 1) {
      throw new Error("至少保留一个 Provider。");
    }
    if (!this.getProviderRow(id)) {
      throw new Error(`找不到 Provider：${id}`);
    }

    const fallback = providers.find((provider) => provider.id !== id);
    if (!fallback) {
      throw new Error("至少保留一个 Provider。");
    }

    for (const profile of this.listRouteProfiles()) {
      const nextRoutes = profile.routes.map((route) => {
        if (route.providerId !== id) {
          return route;
        }
        return {
          ...route,
          providerId: fallback.id,
          modelId: fallback.default_model,
        };
      });
      this.saveProfileRoutes(profile.id, nextRoutes);
    }

    this.db.prepare("DELETE FROM provider_configs WHERE id = ?").run(id);
  }

  listRouteProfiles(): RouteProfileView[] {
    return this.listRouteProfileRows().map((row) => profileRowToView(row, this.listRoutesForProfile(row.id)));
  }

  saveRouteProfile(input: RouteProfileInput): RouteProfileView {
    validateRouteProfileInput(input);
    const now = new Date().toISOString();
    const existing = input.id ? this.getRouteProfileRow(input.id) : undefined;
    const id = input.id ?? createRouteProfileId(input.name);
    const createdAt = existing?.created_at ?? now;

    this.db
      .prepare(`
        INSERT INTO route_profiles (id, name, is_active, created_at, updated_at)
        VALUES (?, ?, 0, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          updated_at = excluded.updated_at
      `)
      .run(id, input.name.trim(), createdAt, now);

    this.saveProfileRoutes(id, input.routes);

    return profileRowToView(
      this.getRouteProfileRow(id) ?? fail(`Route profile ${id} was not saved`),
      this.listRoutesForProfile(id),
    );
  }

  deleteRouteProfile(id: string): void {
    const profiles = this.listRouteProfileRows();
    if (profiles.length <= 1) {
      throw new Error("至少保留一套角色路由配置。");
    }
    const target = profiles.find((profile) => profile.id === id);
    if (!target) {
      throw new Error(`找不到路由配置：${id}`);
    }

    this.db.prepare("DELETE FROM role_routes WHERE profile_id = ?").run(id);
    this.db.prepare("DELETE FROM route_profiles WHERE id = ?").run(id);
  }

  private saveProfileRoutes(profileId: string, routes: RoleRouteConfig[]): void {
    const normalizedRoutes = normalizeProfileRoutes(routes);
    this.db.prepare("DELETE FROM role_routes WHERE profile_id = ?").run(profileId);
    for (const route of normalizedRoutes) {
      this.saveRoleRoute(profileId, route);
    }
  }

  private saveRoleRoute(profileId: string, route: RoleRouteConfig): void {
    if (!AGENT_ROLES.includes(route.role)) {
      throw new Error(`Unsupported role: ${route.role}`);
    }
    if (!this.getProviderRow(route.providerId)) {
      throw new Error(`Provider ${route.providerId} does not exist`);
    }
    if (!route.modelId.trim()) {
      throw new Error(`Model id is required for ${route.role}`);
    }

    const thinkingEffort = normalizeThinkingEffort(route.thinkingEffort);
    const modelsDev = normalizeModelsDevMapping(route.modelsDevMapping);
    const manual = normalizeManualSpec(route.manualSpec);
    this.db
      .prepare(`
        INSERT INTO role_routes (
          profile_id, role, provider_id, model_id, api_compat, thinking_effort,
          models_dev_provider_key, models_dev_model_id,
          manual_context_tokens, manual_input_per_m, manual_output_per_m,
          manual_cache_read_per_m, manual_cache_write_per_m,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(profile_id, role) DO UPDATE SET
          provider_id = excluded.provider_id,
          model_id = excluded.model_id,
          api_compat = excluded.api_compat,
          thinking_effort = excluded.thinking_effort,
          models_dev_provider_key = excluded.models_dev_provider_key,
          models_dev_model_id = excluded.models_dev_model_id,
          manual_context_tokens = excluded.manual_context_tokens,
          manual_input_per_m = excluded.manual_input_per_m,
          manual_output_per_m = excluded.manual_output_per_m,
          manual_cache_read_per_m = excluded.manual_cache_read_per_m,
          manual_cache_write_per_m = excluded.manual_cache_write_per_m,
          updated_at = excluded.updated_at
      `)
      .run(
        profileId,
        route.role,
        route.providerId,
        route.modelId.trim(),
        route.apiCompat ?? null,
        thinkingEffort,
        modelsDev?.providerKey ?? null,
        modelsDev?.modelId ?? null,
        manual?.contextTokens ?? null,
        manual?.inputPerM ?? null,
        manual?.outputPerM ?? null,
        manual?.cacheReadPerM ?? null,
        manual?.cacheWritePerM ?? null,
        new Date().toISOString(),
      );
  }

  private listRoutesForProfile(profileId: string): RoleRouteConfig[] {
    return this.db
      .prepare(`
        SELECT profile_id, role, provider_id, model_id, api_compat, thinking_effort,
               models_dev_provider_key, models_dev_model_id,
               manual_context_tokens, manual_input_per_m, manual_output_per_m,
               manual_cache_read_per_m, manual_cache_write_per_m
        FROM role_routes
        WHERE profile_id = ?
        ORDER BY role
      `)
      .all(profileId)
      .map((row) => routeRowToConfig(row as unknown as RouteRow));
  }

  private migrateProviderRequestPath(): void {
    const columns = this.db.prepare("PRAGMA table_info(provider_configs)").all() as Array<{ name: string }>;
    if (!columns.some((column) => column.name === "request_path")) {
      this.db.exec(`ALTER TABLE provider_configs ADD COLUMN request_path TEXT NOT NULL DEFAULT ''`);
    }

    const rows = this.db
      .prepare("SELECT id, base_url, request_path FROM provider_configs")
      .all() as Array<{ id: string; base_url: string; request_path: string }>;

    for (const row of rows) {
      if (row.request_path) {
        continue;
      }
      const split = splitBaseUrlAndRequestPath(row.base_url);
      // Only split `/anthropic`-style message prefixes; keep service roots like `/zen` in base_url.
      if (split.requestPath === "/anthropic" && split.baseUrl !== row.base_url) {
        this.db
          .prepare("UPDATE provider_configs SET base_url = ?, request_path = ? WHERE id = ?")
          .run(split.baseUrl, split.requestPath, row.id);
      }
    }
  }

  private migrateRoleRoutesToProfiles(): void {
    const tables = this.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'role_routes'")
      .all() as Array<{ name: string }>;
    if (tables.length === 0) {
      this.db.exec(`
        CREATE TABLE role_routes (
          profile_id TEXT NOT NULL,
          role TEXT NOT NULL,
          provider_id TEXT NOT NULL,
          model_id TEXT NOT NULL,
          thinking_effort TEXT,
          models_dev_provider_key TEXT,
          models_dev_model_id TEXT,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (profile_id, role),
          FOREIGN KEY(profile_id) REFERENCES route_profiles(id),
          FOREIGN KEY(provider_id) REFERENCES provider_configs(id)
        );
      `);
      return;
    }

    const columns = this.db.prepare("PRAGMA table_info(role_routes)").all() as Array<{ name: string }>;
    if (columns.some((column) => column.name === "profile_id")) {
      return;
    }

    const legacyRoutes = this.db
      .prepare("SELECT role, provider_id, model_id, thinking_effort FROM role_routes ORDER BY role")
      .all() as unknown as LegacyRouteRow[];

    this.db.exec(`
      CREATE TABLE role_routes_migrated (
        profile_id TEXT NOT NULL,
        role TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        model_id TEXT NOT NULL,
        thinking_effort TEXT,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (profile_id, role),
        FOREIGN KEY(profile_id) REFERENCES route_profiles(id),
        FOREIGN KEY(provider_id) REFERENCES provider_configs(id)
      );
    `);

    const now = new Date().toISOString();
    this.db
      .prepare(`
        INSERT INTO route_profiles (id, name, is_active, created_at, updated_at)
        VALUES (?, ?, 1, ?, ?)
      `)
      .run(DEFAULT_ROUTE_PROFILE_ID, "默认", now, now);

    const insertRoute = this.db.prepare(`
      INSERT INTO role_routes_migrated (profile_id, role, provider_id, model_id, thinking_effort, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    for (const route of legacyRoutes) {
      insertRoute.run(
        DEFAULT_ROUTE_PROFILE_ID,
        route.role,
        route.provider_id,
        route.model_id,
        route.thinking_effort,
        now,
      );
    }

    this.db.exec("DROP TABLE role_routes");
    this.db.exec("ALTER TABLE role_routes_migrated RENAME TO role_routes");
  }

  private migrateRoleRoutesThinkingEffort(): void {
    const columns = this.db.prepare("PRAGMA table_info(role_routes)").all() as Array<{ name: string }>;
    if (columns.some((column) => column.name === "thinking_effort")) {
      return;
    }
    this.db.exec("ALTER TABLE role_routes ADD COLUMN thinking_effort TEXT");
  }

  private migrateRoleRoutesModelsDevMapping(): void {
    const columns = this.db.prepare("PRAGMA table_info(role_routes)").all() as Array<{ name: string }>;
    if (columns.some((column) => column.name === "models_dev_provider_key")) {
      return;
    }
    this.db.exec(`
      ALTER TABLE role_routes ADD COLUMN models_dev_provider_key TEXT;
      ALTER TABLE role_routes ADD COLUMN models_dev_model_id TEXT;
    `);
  }

  private migrateRoleRoutesManualSpec(): void {
    const columns = this.db.prepare("PRAGMA table_info(role_routes)").all() as Array<{ name: string }>;
    if (columns.some((column) => column.name === "manual_context_tokens")) {
      return;
    }
    this.db.exec(`
      ALTER TABLE role_routes ADD COLUMN manual_context_tokens INTEGER;
      ALTER TABLE role_routes ADD COLUMN manual_input_per_m REAL;
      ALTER TABLE role_routes ADD COLUMN manual_output_per_m REAL;
      ALTER TABLE role_routes ADD COLUMN manual_cache_read_per_m REAL;
      ALTER TABLE role_routes ADD COLUMN manual_cache_write_per_m REAL;
    `);
  }

  private migrateProviderApiCompat(): void {
    const columns = this.db.prepare("PRAGMA table_info(provider_configs)").all() as Array<{ name: string }>;
    if (columns.some((column) => column.name === "api_compat")) {
      return;
    }
    this.db.exec(`ALTER TABLE provider_configs ADD COLUMN api_compat TEXT NOT NULL DEFAULT 'anthropic'`);
  }

  private migrateRoleRoutesApiCompat(): void {
    const columns = this.db.prepare("PRAGMA table_info(role_routes)").all() as Array<{ name: string }>;
    if (columns.some((column) => column.name === "api_compat")) {
      return;
    }
    this.db.exec(`ALTER TABLE role_routes ADD COLUMN api_compat TEXT`);
  }

  /** Rename legacy `openai` stored value to `openai_responses`. */
  private migrateLegacyOpenaiApiCompatValues(): void {
    this.db.exec(`
      UPDATE provider_configs SET api_compat = 'openai_responses' WHERE api_compat = 'openai';
      UPDATE role_routes SET api_compat = 'openai_responses' WHERE api_compat = 'openai';
    `);
  }

  private listProviderRows(): ProviderRow[] {
    return this.db
      .prepare(`
        SELECT id, name, base_url, request_path, api_compat, api_key, default_model, enabled, created_at, updated_at
        FROM provider_configs
        ORDER BY updated_at DESC, name ASC
      `)
      .all() as unknown as ProviderRow[];
  }

  private getProviderRow(id: string): ProviderRow | undefined {
    return this.db
      .prepare(`
        SELECT id, name, base_url, request_path, api_compat, api_key, default_model, enabled, created_at, updated_at
        FROM provider_configs
        WHERE id = ?
      `)
      .get(id) as ProviderRow | undefined;
  }

  private listRouteProfileRows(): RouteProfileRow[] {
    return this.db
      .prepare(`
        SELECT id, name, is_active, created_at, updated_at
        FROM route_profiles
        ORDER BY updated_at DESC, name ASC
      `)
      .all() as unknown as RouteProfileRow[];
  }

  private getRouteProfileRow(id: string): RouteProfileRow | undefined {
    return this.db
      .prepare(`
        SELECT id, name, is_active, created_at, updated_at
        FROM route_profiles
        WHERE id = ?
      `)
      .get(id) as RouteProfileRow | undefined;
  }
}

function providerRowToView(row: ProviderRow): ProviderConfigView {
  const provider: ProviderConfigView = {
    id: row.id,
    name: row.name,
    baseUrl: row.base_url,
    requestPath: row.request_path ?? "",
    apiCompat: normalizeUpstreamApiCompat(row.api_compat),
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

function profileRowToView(row: RouteProfileRow, routes: RoleRouteConfig[]): RouteProfileView {
  return {
    id: row.id,
    name: row.name,
    routes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function routeRowToConfig(row: RouteRow): RoleRouteConfig {
  const effort = parseThinkingEffort(row.thinking_effort);
  const modelsDevMapping = parseModelsDevMapping(row.models_dev_provider_key, row.models_dev_model_id);
  const manualSpec = parseManualSpecRow(row);
  const apiCompat = row.api_compat ? normalizeUpstreamApiCompat(row.api_compat) : undefined;
  return {
    role: row.role,
    providerId: row.provider_id,
    modelId: row.model_id,
    ...(apiCompat && { apiCompat }),
    ...(effort && { thinkingEffort: effort }),
    ...(modelsDevMapping && { modelsDevMapping }),
    ...(manualSpec && { manualSpec }),
  };
}

const THINKING_EFFORT_VALUES = new Set<ThinkingEffort>(["off", "low", "medium", "high", "xhigh", "max"]);

function parseThinkingEffort(value: string | null | undefined): ThinkingEffort | undefined {
  if (!value) {
    return undefined;
  }
  return THINKING_EFFORT_VALUES.has(value as ThinkingEffort) ? (value as ThinkingEffort) : undefined;
}

function normalizeThinkingEffort(value: ThinkingEffort | undefined): string | null {
  if (!value) {
    return null;
  }
  return THINKING_EFFORT_VALUES.has(value) ? value : null;
}

function parseModelsDevMapping(
  providerKey: string | null | undefined,
  modelId: string | null | undefined,
): RoleRouteConfig["modelsDevMapping"] {
  if (!providerKey?.trim() || !modelId?.trim()) {
    return undefined;
  }
  return {
    providerKey: providerKey.trim(),
    modelId: modelId.trim(),
  };
}

function normalizeModelsDevMapping(
  value: RoleRouteConfig["modelsDevMapping"],
): RoleRouteConfig["modelsDevMapping"] {
  if (!value?.providerKey.trim() || !value.modelId.trim()) {
    return undefined;
  }
  return {
    providerKey: value.providerKey.trim(),
    modelId: value.modelId.trim(),
  };
}

function parseManualSpecRow(row: RouteRow): RouteManualSpec | undefined {
  const contextTokens = parsePositiveInt(row.manual_context_tokens);
  const inputPerM = parsePositiveNumber(row.manual_input_per_m);
  const outputPerM = parsePositiveNumber(row.manual_output_per_m);
  const cacheReadPerM = parsePositiveNumber(row.manual_cache_read_per_m);
  const cacheWritePerM = parsePositiveNumber(row.manual_cache_write_per_m);
  if (
    contextTokens === undefined &&
    inputPerM === undefined &&
    outputPerM === undefined &&
    cacheReadPerM === undefined &&
    cacheWritePerM === undefined
  ) {
    return undefined;
  }
  return {
    ...(contextTokens !== undefined && { contextTokens }),
    ...(inputPerM !== undefined && { inputPerM }),
    ...(outputPerM !== undefined && { outputPerM }),
    ...(cacheReadPerM !== undefined && { cacheReadPerM }),
    ...(cacheWritePerM !== undefined && { cacheWritePerM }),
  };
}

function normalizeManualSpec(value: RouteManualSpec | undefined): RouteManualSpec | undefined {
  if (!value) {
    return undefined;
  }
  const contextTokens = parsePositiveInt(value.contextTokens);
  const inputPerM = parsePositiveNumber(value.inputPerM);
  const outputPerM = parsePositiveNumber(value.outputPerM);
  const cacheReadPerM = parsePositiveNumber(value.cacheReadPerM);
  const cacheWritePerM = parsePositiveNumber(value.cacheWritePerM);
  if (
    contextTokens === undefined &&
    inputPerM === undefined &&
    outputPerM === undefined &&
    cacheReadPerM === undefined &&
    cacheWritePerM === undefined
  ) {
    return undefined;
  }
  return {
    ...(contextTokens !== undefined && { contextTokens }),
    ...(inputPerM !== undefined && { inputPerM }),
    ...(outputPerM !== undefined && { outputPerM }),
    ...(cacheReadPerM !== undefined && { cacheReadPerM }),
    ...(cacheWritePerM !== undefined && { cacheWritePerM }),
  };
}

function parsePositiveInt(value: number | undefined | null): number | undefined {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return undefined;
  }
  const rounded = Math.floor(value);
  return rounded > 0 ? rounded : undefined;
}

function parsePositiveNumber(value: number | undefined | null): number | undefined {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return undefined;
  }
  return value > 0 ? value : undefined;
}

function normalizeProfileRoutes(routes: RoleRouteConfig[]): RoleRouteConfig[] {
  const routesByRole = new Map<AgentRole, RoleRouteConfig>();
  for (const route of routes) {
    routesByRole.set(route.role, route);
  }
  return AGENT_ROLES.map((role) => {
    const route = routesByRole.get(role);
    if (!route) {
      throw new Error(`Route for ${role} is required.`);
    }
    return route;
  });
}

function validateProviderInput(input: ProviderConfigInput): void {
  if (!input.name.trim()) throw new Error("Provider name is required.");
  if (!input.baseUrl.trim().startsWith("http://") && !input.baseUrl.trim().startsWith("https://")) {
    throw new Error("Provider baseURL must start with http:// or https://.");
  }
  const requestPath = input.requestPath?.trim();
  if (requestPath && !requestPath.startsWith("/")) {
    throw new Error("请求端点须以 / 开头，例如 /anthropic。");
  }
  if (!input.defaultModel.trim()) throw new Error("Default model is required.");
}

function validateRouteProfileInput(input: RouteProfileInput): void {
  if (!input.name.trim()) {
    throw new Error("路由配置名称不能为空。");
  }
  normalizeProfileRoutes(input.routes);
}

function createProviderId(name: string): string {
  const suffix = Math.random().toString(36).slice(2, 8);
  const normalizedName = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  return `${normalizedName || "provider"}-${suffix}`;
}

function createRouteProfileId(name: string): string {
  const suffix = Math.random().toString(36).slice(2, 8);
  const normalizedName = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  return `${normalizedName || "route-profile"}-${suffix}`;
}

function previewSecret(secret: string): string | undefined {
  if (!secret) return undefined;
  if (secret.length <= 8) return "saved";
  return `${secret.slice(0, 4)}...${secret.slice(-4)}`;
}

function fail(message: string): never {
  throw new Error(message);
}
