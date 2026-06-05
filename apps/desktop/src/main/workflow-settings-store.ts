import fs from "node:fs/promises";
import path from "node:path";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";
import type { EcoOrchestrationMode } from "@eco/runtime";

export type OrchestrationModeSetting = "autonomous" | "manual";

export interface WorkflowSettingsSnapshot {
  orchestrationMode: OrchestrationModeSetting;
}

export function defaultWorkflowSettings(): WorkflowSettingsSnapshot {
  return { orchestrationMode: "autonomous" };
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
        .run("orchestration_mode", JSON.stringify("autonomous"), now);
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
  return settings.orchestrationMode;
}

export function usesManualOrchestration(settings: WorkflowSettingsSnapshot): boolean {
  return settings.orchestrationMode === "manual";
}

/** @deprecated Use usesManualOrchestration */
export function usesPlanOrchestration(settings: WorkflowSettingsSnapshot): boolean {
  return usesManualOrchestration(settings);
}

function snapshotFromStoredOrchestration(mode: EcoOrchestrationMode): WorkflowSettingsSnapshot {
  return { orchestrationMode: mode === "manual" ? "manual" : "autonomous" };
}

function parseStoredOrchestration(raw: string | undefined): EcoOrchestrationMode {
  if (raw === "manual" || raw === "autonomous") {
    return raw;
  }
  if (raw === "analyze_plan_execute") {
    return "manual";
  }
  if (raw === "sdk_default") {
    return "autonomous";
  }
  try {
    const parsed = JSON.parse(raw ?? "") as unknown;
    if (parsed === "manual" || parsed === "autonomous") {
      return parsed;
    }
    if (parsed === "analyze_plan_execute") {
      return "manual";
    }
    if (parsed === "sdk_default") {
      return "autonomous";
    }
    if (typeof parsed === "boolean") {
      return parsed ? "manual" : "autonomous";
    }
  } catch {
    // ignore
  }
  return "autonomous";
}

export function normalizeWorkflowSettingsSnapshot(value: unknown): WorkflowSettingsSnapshot {
  if (!value || typeof value !== "object") {
    return defaultWorkflowSettings();
  }
  const record = value as Record<string, unknown>;
  if (record.orchestrationMode === "manual" || record.orchestrationMode === "autonomous") {
    return { orchestrationMode: record.orchestrationMode };
  }
  if (record.orchestrationMode === "analyze_plan_execute") {
    return { orchestrationMode: "manual" };
  }
  if (record.orchestrationMode === "sdk_default") {
    return { orchestrationMode: "autonomous" };
  }
  if (typeof record.planModeEnabled === "boolean") {
    return { orchestrationMode: record.planModeEnabled ? "manual" : "autonomous" };
  }
  return defaultWorkflowSettings();
}

export function isWorkflowSettingsSnapshot(value: unknown): value is WorkflowSettingsSnapshot {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (record.orchestrationMode === "manual" || record.orchestrationMode === "autonomous") {
    return true;
  }
  if (record.orchestrationMode === "analyze_plan_execute" || record.orchestrationMode === "sdk_default") {
    return true;
  }
  return typeof record.planModeEnabled === "boolean";
}
