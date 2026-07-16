import fs from "node:fs/promises";
import path from "node:path";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";
import {
  normalizeSkillsEnabled,
  type ProjectSkillsSettingsSnapshot,
} from "../shared/composer-skills-settings";

export async function createProjectSkillsSettingsStore(dbPath: string): Promise<ProjectSkillsSettingsStore> {
  await fs.mkdir(path.dirname(dbPath), { recursive: true });
  const sqlite = await import("node:sqlite");
  const store = new ProjectSkillsSettingsStore(new sqlite.DatabaseSync(dbPath));
  store.initialize();
  return store;
}

export class ProjectSkillsSettingsStore {
  constructor(private readonly db: DatabaseSyncType) {}

  initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS project_skills_settings (
        workspace_path TEXT PRIMARY KEY,
        enabled_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  }

  get(workspacePath: string): ProjectSkillsSettingsSnapshot {
    const normalizedPath = path.resolve(workspacePath);
    const row = this.db
      .prepare(`SELECT enabled_json FROM project_skills_settings WHERE workspace_path = ?`)
      .get(normalizedPath) as { enabled_json: string } | undefined;
    if (!row) return { workspacePath: normalizedPath, enabledByPath: {} };
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.enabled_json) as unknown;
    } catch {
      throw new Error(`项目 Skills 配置损坏：${normalizedPath}`);
    }
    return {
      workspacePath: normalizedPath,
      enabledByPath: normalizeSkillsEnabled(parsed) ?? {},
    };
  }

  save(snapshot: ProjectSkillsSettingsSnapshot): ProjectSkillsSettingsSnapshot {
    const workspacePath = path.resolve(snapshot.workspacePath);
    const enabledByPath = normalizeSkillsEnabled(snapshot.enabledByPath) ?? {};
    this.db
      .prepare(
        `INSERT INTO project_skills_settings (workspace_path, enabled_json, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(workspace_path) DO UPDATE SET
           enabled_json = excluded.enabled_json,
           updated_at = excluded.updated_at`,
      )
      .run(workspacePath, JSON.stringify(enabledByPath), new Date().toISOString());
    return { workspacePath, enabledByPath };
  }
}
