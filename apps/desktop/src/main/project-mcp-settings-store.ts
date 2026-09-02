import fs from "node:fs/promises";
import path from "node:path";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";
import { normalizeMcpServersEnabled, type ProjectMcpSettingsSnapshot } from "../shared/composer-mcp";

export async function createProjectMcpSettingsStore(dbPath: string): Promise<ProjectMcpSettingsStore> {
  await fs.mkdir(path.dirname(dbPath), { recursive: true });
  const sqlite = await import("node:sqlite");
  const store = new ProjectMcpSettingsStore(new sqlite.DatabaseSync(dbPath));
  store.initialize();
  return store;
}

export class ProjectMcpSettingsStore {
  constructor(private readonly db: DatabaseSyncType) {}

  initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS project_mcp_settings (
        workspace_path TEXT PRIMARY KEY,
        enabled_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  }

  get(workspacePath: string): ProjectMcpSettingsSnapshot {
    const normalizedPath = path.resolve(workspacePath);
    const row = this.db
      .prepare(`SELECT enabled_json FROM project_mcp_settings WHERE workspace_path = ?`)
      .get(normalizedPath) as { enabled_json: string } | undefined;
    if (!row) return { workspacePath: normalizedPath, enabledByServer: {} };
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.enabled_json) as unknown;
    } catch {
      throw new Error(`项目 MCP 配置损坏：${normalizedPath}`);
    }
    return {
      workspacePath: normalizedPath,
      enabledByServer: normalizeMcpServersEnabled(parsed) ?? {},
    };
  }

  save(snapshot: ProjectMcpSettingsSnapshot): ProjectMcpSettingsSnapshot {
    const workspacePath = path.resolve(snapshot.workspacePath);
    const enabledByServer = normalizeMcpServersEnabled(snapshot.enabledByServer) ?? {};
    this.db
      .prepare(
        `INSERT INTO project_mcp_settings (workspace_path, enabled_json, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(workspace_path) DO UPDATE SET
           enabled_json = excluded.enabled_json,
           updated_at = excluded.updated_at`,
      )
      .run(workspacePath, JSON.stringify(enabledByServer), new Date().toISOString());
    return { workspacePath, enabledByServer };
  }
}
