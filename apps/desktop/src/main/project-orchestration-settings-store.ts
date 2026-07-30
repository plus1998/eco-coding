import fs from "node:fs/promises";
import path from "node:path";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";
import type { OrchestrationSelection } from "../shared/agent-orchestration";
import {
  normalizeProjectOrchestrationSelection,
  type ProjectOrchestrationSettingsSnapshot,
} from "../shared/project-orchestration-settings";

export async function createProjectOrchestrationSettingsStore(
  dbPath: string,
): Promise<ProjectOrchestrationSettingsStore> {
  await fs.mkdir(path.dirname(dbPath), { recursive: true });
  const sqlite = await import("node:sqlite");
  const store = new ProjectOrchestrationSettingsStore(new sqlite.DatabaseSync(dbPath));
  store.initialize();
  return store;
}

export class ProjectOrchestrationSettingsStore {
  constructor(private readonly db: DatabaseSyncType) {}

  initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS project_orchestration_settings (
        workspace_path TEXT PRIMARY KEY,
        selection_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  }

  get(workspacePath: string): ProjectOrchestrationSettingsSnapshot {
    const normalizedPath = path.resolve(workspacePath);
    const row = this.db
      .prepare(
        `SELECT selection_json FROM project_orchestration_settings WHERE workspace_path = ?`,
      )
      .get(normalizedPath) as { selection_json: string } | undefined;
    if (!row) {
      return { workspacePath: normalizedPath };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.selection_json) as unknown;
    } catch {
      throw new Error(`项目编排配置损坏：${normalizedPath}`);
    }
    const orchestrationSelection = normalizeProjectOrchestrationSelection(parsed);
    if (!orchestrationSelection) {
      throw new Error(`项目编排配置无效：${normalizedPath}`);
    }
    return { workspacePath: normalizedPath, orchestrationSelection };
  }

  save(snapshot: {
    workspacePath: string;
    orchestrationSelection: OrchestrationSelection;
  }): ProjectOrchestrationSettingsSnapshot {
    const workspacePath = path.resolve(snapshot.workspacePath);
    const orchestrationSelection = normalizeProjectOrchestrationSelection(
      snapshot.orchestrationSelection,
    );
    if (!orchestrationSelection) {
      throw new Error("项目编排配置必须是完整有效的编排组合。");
    }
    this.db
      .prepare(
        `INSERT INTO project_orchestration_settings (workspace_path, selection_json, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(workspace_path) DO UPDATE SET
           selection_json = excluded.selection_json,
           updated_at = excluded.updated_at`,
      )
      .run(workspacePath, JSON.stringify(orchestrationSelection), new Date().toISOString());
    return { workspacePath, orchestrationSelection };
  }

  listSelections(): OrchestrationSelection[] {
    const rows = this.db
      .prepare(`SELECT selection_json FROM project_orchestration_settings`)
      .all() as Array<{ selection_json: string }>;
    return rows
      .map((row) => {
        try {
          return normalizeProjectOrchestrationSelection(JSON.parse(row.selection_json) as unknown);
        } catch {
          return undefined;
        }
      })
      .filter((selection): selection is OrchestrationSelection => Boolean(selection));
  }
}
