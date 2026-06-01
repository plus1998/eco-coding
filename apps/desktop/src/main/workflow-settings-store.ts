import fs from "node:fs/promises";
import path from "node:path";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";
import type { EcoOrchestrationMode } from "@eco/runtime";

export interface WorkflowSettingsSnapshot {
  /** 开启：先探索与计划确认，再执行；关闭：Claude Code 预设单次会话。默认开启。 */
  planModeEnabled: boolean;
}

export function defaultWorkflowSettings(): WorkflowSettingsSnapshot {
  return { planModeEnabled: true };
}

export async function createWorkflowSettingsStore(dbPath: string): Promise<WorkflowSettingsStore> {
  await fs.mkdir(path.dirname(dbPath), { recursive: true });
  const sqlite = await import("node:sqlite");
  const store = new WorkflowSettingsStore(new sqlite.DatabaseSync(dbPath));
  store.initialize();
  return store;
}

export class WorkflowSettingsStore {
  constructor(private readonly db: DatabaseSyncType) {}

  initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS workflow_settings (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);

    const row = this.db
      .prepare(`SELECT key FROM workflow_settings WHERE key = ?`)
      .get("orchestration_mode") as { key: string } | undefined;
    if (!row) {
      const now = new Date().toISOString();
      this.db
        .prepare(`INSERT INTO workflow_settings (key, value_json, updated_at) VALUES (?, ?, ?)`)
        .run("orchestration_mode", JSON.stringify("analyze_plan_execute"), now);
    }
  }

  get(): WorkflowSettingsSnapshot {
    const row = this.db
      .prepare(`SELECT value_json FROM workflow_settings WHERE key = ?`)
      .get("orchestration_mode") as { value_json: string } | undefined;
    return snapshotFromStoredOrchestration(parseStoredOrchestration(row?.value_json));
  }

  save(snapshot: WorkflowSettingsSnapshot): WorkflowSettingsSnapshot {
    const mode = orchestrationModeFromSnapshot(snapshot);
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO workflow_settings (key, value_json, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
      )
      .run("orchestration_mode", JSON.stringify(mode), now);
    return this.get();
  }
}

export function orchestrationModeFromSnapshot(
  settings: WorkflowSettingsSnapshot,
): EcoOrchestrationMode {
  return settings.planModeEnabled ? "analyze_plan_execute" : "sdk_default";
}

export function usesPlanOrchestration(settings: WorkflowSettingsSnapshot): boolean {
  return settings.planModeEnabled;
}

function snapshotFromStoredOrchestration(mode: EcoOrchestrationMode): WorkflowSettingsSnapshot {
  return { planModeEnabled: mode !== "sdk_default" };
}

function parseStoredOrchestration(raw: string | undefined): EcoOrchestrationMode {
  if (raw === "sdk_default" || raw === "analyze_plan_execute") {
    return raw;
  }
  try {
    const parsed = JSON.parse(raw ?? "") as unknown;
    if (parsed === "sdk_default" || parsed === "analyze_plan_execute") {
      return parsed;
    }
    if (typeof parsed === "boolean") {
      return parsed ? "analyze_plan_execute" : "sdk_default";
    }
  } catch {
    // ignore
  }
  return "analyze_plan_execute";
}

export function normalizeWorkflowSettingsSnapshot(value: unknown): WorkflowSettingsSnapshot {
  if (!value || typeof value !== "object") {
    return defaultWorkflowSettings();
  }
  const record = value as Record<string, unknown>;
  if (typeof record.planModeEnabled === "boolean") {
    return { planModeEnabled: record.planModeEnabled };
  }
  if (record.orchestrationMode === "sdk_default") {
    return { planModeEnabled: false };
  }
  if (record.orchestrationMode === "analyze_plan_execute") {
    return { planModeEnabled: true };
  }
  return defaultWorkflowSettings();
}

export function isWorkflowSettingsSnapshot(value: unknown): value is WorkflowSettingsSnapshot {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.planModeEnabled === "boolean") {
    return true;
  }
  return record.orchestrationMode === "sdk_default" || record.orchestrationMode === "analyze_plan_execute";
}
