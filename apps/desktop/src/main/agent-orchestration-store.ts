import fs from "node:fs/promises";
import path from "node:path";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";
import type { AgentTemplate, OrchestrationProfile } from "../shared/agent-orchestration";

interface StoredConfigRow {
  id: string;
  value_json: string;
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
    `);
  }

  listAgentTemplates(): AgentTemplate[] {
    return this.db
      .prepare(`SELECT id, value_json FROM agent_templates ORDER BY id ASC`)
      .all()
      .map((row) => parseAgentTemplateRow(row as unknown as StoredConfigRow));
  }

  saveAgentTemplate(template: AgentTemplate): AgentTemplate {
    const normalized = normalizeStoredAgentTemplate(template);
    this.db
      .prepare(`
        INSERT INTO agent_templates (id, value_json, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at
      `)
      .run(normalized.id, JSON.stringify(normalized), normalized.updatedAt);
    return normalized;
  }

  deleteAgentTemplate(id: string): void {
    this.db.prepare(`DELETE FROM agent_templates WHERE id = ?`).run(id.trim());
  }

  listOrchestrationProfiles(): OrchestrationProfile[] {
    return this.db
      .prepare(`SELECT id, value_json FROM orchestration_profiles ORDER BY id ASC`)
      .all()
      .map((row) => parseOrchestrationProfileRow(row as unknown as StoredConfigRow));
  }

  saveOrchestrationProfile(profile: OrchestrationProfile): OrchestrationProfile {
    const normalized = normalizeStoredOrchestrationProfile(profile);
    this.db
      .prepare(`
        INSERT INTO orchestration_profiles (id, value_json, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at
      `)
      .run(normalized.id, JSON.stringify(normalized), normalized.updatedAt);
    return normalized;
  }

  deleteOrchestrationProfile(id: string): void {
    this.db.prepare(`DELETE FROM orchestration_profiles WHERE id = ?`).run(id.trim());
  }
}

export function normalizeStoredAgentTemplate(template: AgentTemplate): AgentTemplate {
  if (template.builtIn || template.source === "built_in") {
    throw new Error("内置子代理模板不可写入用户配置。");
  }
  if (!template.id.trim()) {
    throw new Error("子代理模板 id 不能为空。");
  }
  if (!template.name.trim()) {
    throw new Error("子代理模板名称不能为空。");
  }
  if (!template.prompt.trim()) {
    throw new Error("子代理模板提示词不能为空。");
  }
  const now = new Date().toISOString();
  return {
    ...template,
    id: template.id.trim(),
    name: template.name.trim(),
    description: template.description.trim(),
    prompt: template.prompt.trim(),
    whenToUse: template.whenToUse.trim(),
    source: template.source === "project" ? "project" : "user",
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
  if (!profile.name.trim()) {
    throw new Error("编排配置名称不能为空。");
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

function parseOrchestrationProfileRow(row: StoredConfigRow): OrchestrationProfile {
  const parsed = parseJsonObject(row.value_json);
  return normalizeStoredOrchestrationProfile(parsed as unknown as OrchestrationProfile);
}

function parseJsonObject(value: string): Record<string, unknown> {
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("配置 JSON 必须是对象。");
  }
  return parsed as Record<string, unknown>;
}
