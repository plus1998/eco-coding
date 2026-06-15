import fs from "node:fs/promises";
import path from "node:path";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";
import type { AgentTemplate, OrchestrationProfile } from "../shared/agent-orchestration";
import type { AgentTemplateVersionView, OrchestrationProfileVersionView } from "../shared/ipc";

interface StoredConfigRow {
  id: string;
  value_json: string;
}

interface StoredTemplateVersionRow {
  template_id: string;
  version: number;
  value_json: string;
  saved_at: string;
}

interface StoredProfileVersionRow {
  profile_id: string;
  version: number;
  value_json: string;
  saved_at: string;
}

export async function createAgentOrchestrationStore(dbPath: string): Promise<AgentOrchestrationStore> {
  await fs.mkdir(path.dirname(dbPath), { recursive: true });
  const sqlite = await import("node:sqlite");
  const store = new AgentOrchestrationStore(new sqlite.DatabaseSync(dbPath));
  store.initialize();
  return store;
}

export class AgentOrchestrationStore {
  constructor(private readonly db: DatabaseSyncType) {}

  initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS agent_templates (
        id TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS orchestration_profiles (
        id TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS agent_template_versions (
        template_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        value_json TEXT NOT NULL,
        saved_at TEXT NOT NULL,
        PRIMARY KEY (template_id, version)
      );

      CREATE TABLE IF NOT EXISTS orchestration_profile_versions (
        profile_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        value_json TEXT NOT NULL,
        saved_at TEXT NOT NULL,
        PRIMARY KEY (profile_id, version)
      );
    `);
  }

  listAgentTemplates(): AgentTemplate[] {
    return this.db
      .prepare(`SELECT id, value_json FROM agent_templates ORDER BY id ASC`)
      .all()
      .map((row) => parseAgentTemplateRow(row as unknown as StoredConfigRow));
  }

  getAgentTemplate(id: string): AgentTemplate | undefined {
    const row = this.db
      .prepare(`SELECT id, value_json FROM agent_templates WHERE id = ?`)
      .get(id.trim()) as unknown as StoredConfigRow | undefined;
    return row ? parseAgentTemplateRow(row) : undefined;
  }

  saveAgentTemplate(template: AgentTemplate): AgentTemplate {
    const normalized = this.normalizeTemplateForSave(template);
    this.db
      .prepare(`
        INSERT INTO agent_templates (id, value_json, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at
      `)
      .run(normalized.id, JSON.stringify(normalized), normalized.updatedAt);
    this.recordAgentTemplateVersion(normalized);
    return normalized;
  }

  deleteAgentTemplate(id: string): void {
    this.db.prepare(`DELETE FROM agent_templates WHERE id = ?`).run(id.trim());
    this.db.prepare(`DELETE FROM agent_template_versions WHERE template_id = ?`).run(id.trim());
  }

  listAgentTemplateVersions(templateId: string): AgentTemplateVersionView[] {
    return this.db
      .prepare(`
        SELECT template_id, version, value_json, saved_at
        FROM agent_template_versions
        WHERE template_id = ?
        ORDER BY version DESC
      `)
      .all(templateId.trim())
      .map((row) => parseAgentTemplateVersionRow(row as unknown as StoredTemplateVersionRow));
  }

  restoreAgentTemplateVersion(templateId: string, version: number): AgentTemplate {
    const row = this.db
      .prepare(`
        SELECT template_id, version, value_json, saved_at
        FROM agent_template_versions
        WHERE template_id = ? AND version = ?
      `)
      .get(templateId.trim(), version) as unknown as StoredTemplateVersionRow | undefined;
    if (!row) {
      throw new Error("找不到指定的子代理模板版本。");
    }
    const restored = parseAgentTemplateVersionRow(row).template;
    const current = this.getAgentTemplate(templateId);
    return this.saveAgentTemplate({
      ...restored,
      version: (current?.version ?? restored.version) + 1,
      updatedAt: new Date().toISOString(),
    });
  }

  listOrchestrationProfiles(): OrchestrationProfile[] {
    const profiles: OrchestrationProfile[] = [];
    for (const row of this.db
      .prepare(`SELECT id, value_json FROM orchestration_profiles ORDER BY id ASC`)
      .all()) {
      const parsed = parseOrchestrationProfileRow(row as unknown as StoredConfigRow);
      if (parsed.ok) {
        profiles.push(parsed.profile);
        continue;
      }
      console.warn(
        `[agent-profile] skipped invalid stored profile ${parsed.id}: ${parsed.error.message}`,
      );
    }
    return profiles;
  }

  saveOrchestrationProfile(profile: OrchestrationProfile): OrchestrationProfile {
    const normalized = this.normalizeProfileForSave(profile);
    this.db
      .prepare(`
        INSERT INTO orchestration_profiles (id, value_json, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at
      `)
      .run(normalized.id, JSON.stringify(normalized), normalized.updatedAt);
    this.recordOrchestrationProfileVersion(normalized);
    return normalized;
  }

  deleteOrchestrationProfile(id: string): void {
    this.db.prepare(`DELETE FROM orchestration_profiles WHERE id = ?`).run(id.trim());
    this.db.prepare(`DELETE FROM orchestration_profile_versions WHERE profile_id = ?`).run(id.trim());
  }

  listOrchestrationProfileVersions(profileId: string): OrchestrationProfileVersionView[] {
    return this.db
      .prepare(`
        SELECT profile_id, version, value_json, saved_at
        FROM orchestration_profile_versions
        WHERE profile_id = ?
        ORDER BY version DESC
      `)
      .all(profileId.trim())
      .map((row) => parseOrchestrationProfileVersionRow(row as unknown as StoredProfileVersionRow));
  }

  restoreOrchestrationProfileVersion(profileId: string, version: number): OrchestrationProfile {
    const row = this.db
      .prepare(`
        SELECT profile_id, version, value_json, saved_at
        FROM orchestration_profile_versions
        WHERE profile_id = ? AND version = ?
      `)
      .get(profileId.trim(), version) as unknown as StoredProfileVersionRow | undefined;
    if (!row) {
      throw new Error("找不到指定的 Agent Profile 版本。");
    }
    const restored = parseOrchestrationProfileVersionRow(row).profile;
    const current = this.listOrchestrationProfiles().find((profile) => profile.id === profileId.trim());
    return this.saveOrchestrationProfile({
      ...restored,
      version: (current?.version ?? restored.version) + 1,
      updatedAt: new Date().toISOString(),
    });
  }

  private normalizeTemplateForSave(template: AgentTemplate): AgentTemplate {
    const normalized = normalizeStoredAgentTemplate(template);
    const existing = this.getAgentTemplate(normalized.id);
    if (!existing) {
      return normalized;
    }
    return {
      ...normalized,
      version: Math.max(normalized.version, existing.version + 1),
    };
  }

  private recordAgentTemplateVersion(template: AgentTemplate): void {
    this.db
      .prepare(`
        INSERT INTO agent_template_versions (template_id, version, value_json, saved_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(template_id, version) DO UPDATE SET
          value_json = excluded.value_json,
          saved_at = excluded.saved_at
      `)
      .run(template.id, template.version, JSON.stringify(template), template.updatedAt);
  }

  private normalizeProfileForSave(profile: OrchestrationProfile): OrchestrationProfile {
    const normalized = normalizeStoredOrchestrationProfile(profile);
    const existing = this.listOrchestrationProfiles().find((entry) => entry.id === normalized.id);
    if (!existing) {
      return normalized;
    }
    return {
      ...normalized,
      version: Math.max(normalized.version, existing.version + 1),
    };
  }

  private recordOrchestrationProfileVersion(profile: OrchestrationProfile): void {
    this.db
      .prepare(`
        INSERT INTO orchestration_profile_versions (profile_id, version, value_json, saved_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(profile_id, version) DO UPDATE SET
          value_json = excluded.value_json,
          saved_at = excluded.saved_at
      `)
      .run(profile.id, profile.version, JSON.stringify(profile), profile.updatedAt);
  }
}

export function normalizeStoredAgentTemplate(template: AgentTemplate): AgentTemplate {
  if (template.builtIn || template.source === "built_in") {
    throw new Error("内置子代理模板不可写入用户配置。");
  }
  if (!template.id.trim()) {
    throw new Error("子代理模板 id 不能为空。");
  }
  if (template.id.trim().startsWith("builtin.")) {
    throw new Error("内置子代理模板 id 不可用于用户配置。");
  }
  if (!template.name.trim()) {
    throw new Error("子代理模板名称不能为空。");
  }
  if (!template.prompt.trim()) {
    throw new Error("子代理模板提示词不能为空。");
  }
  const now = new Date().toISOString();
  const templateWithoutLegacyModel = { ...(template as AgentTemplate & { defaultModelRef?: unknown }) };
  delete templateWithoutLegacyModel.defaultModelRef;
  return {
    ...templateWithoutLegacyModel,
    id: template.id.trim(),
    name: template.name.trim(),
    description: template.description.trim(),
    prompt: template.prompt.trim(),
    whenToUse: template.whenToUse.trim(),
    source: "user",
    builtIn: false,
    updatedAt: template.updatedAt || now,
  };
}

export function normalizeStoredOrchestrationProfile(profile: OrchestrationProfile): OrchestrationProfile {
  if (profile.source === "built_in" || profile.source === "derived") {
    throw new Error("内置或派生编排配置不可写入用户配置。");
  }
  if (!profile.id.trim()) {
    throw new Error("编排配置 id 不能为空。");
  }
  if (profile.id.trim().startsWith("builtin.")) {
    throw new Error("内置编排配置 id 不可用于用户配置。");
  }
  if (!profile.name.trim()) {
    throw new Error("编排配置名称不能为空。");
  }
  if (
    !profile.builtinAgents?.explore?.modelRef?.providerId?.trim() ||
    !profile.builtinAgents.explore.modelRef.modelId?.trim()
  ) {
    throw new Error("Agent Profile 必须配置 Explore 的 provider 和模型。");
  }
  const now = new Date().toISOString();
  return {
    ...profile,
    id: profile.id.trim(),
    name: profile.name.trim(),
    source: profile.source === "project" ? "project" : "user",
    updatedAt: profile.updatedAt || now,
  };
}

function parseAgentTemplateRow(row: StoredConfigRow): AgentTemplate {
  const parsed = parseJsonObject(row.value_json);
  return normalizeStoredAgentTemplate(parsed as unknown as AgentTemplate);
}

function parseOrchestrationProfileRow(
  row: StoredConfigRow,
): { ok: true; profile: OrchestrationProfile } | { ok: false; id: string; error: Error } {
  try {
    const parsed = parseJsonObject(row.value_json);
    return {
      ok: true,
      profile: normalizeStoredOrchestrationProfile(parsed as unknown as OrchestrationProfile),
    };
  } catch (error) {
    return {
      ok: false,
      id: row.id,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}

function parseAgentTemplateVersionRow(row: StoredTemplateVersionRow): AgentTemplateVersionView {
  const template = normalizeStoredAgentTemplate(parseJsonObject(row.value_json) as unknown as AgentTemplate);
  return {
    templateId: row.template_id,
    version: row.version,
    savedAt: row.saved_at,
    template,
  };
}

function parseOrchestrationProfileVersionRow(row: StoredProfileVersionRow): OrchestrationProfileVersionView {
  const profile = normalizeStoredOrchestrationProfile(
    parseJsonObject(row.value_json) as unknown as OrchestrationProfile,
  );
  return {
    profileId: row.profile_id,
    version: row.version,
    savedAt: row.saved_at,
    profile,
  };
}

function parseJsonObject(value: string): Record<string, unknown> {
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("配置 JSON 必须是对象。");
  }
  return parsed as Record<string, unknown>;
}
