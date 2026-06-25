import fs from "node:fs/promises";
import path from "node:path";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";
import type { EcoOrchestrationMode } from "@eco/runtime";
import {
  normalizeMcpServersEnabled,
  type McpServersEnabledSettings,
} from "../shared/composer-mcp";
import { syncSessionModeFields, type SessionMode } from "../shared/session-mode";

export type { SessionMode };

export interface WorkflowSettingsSnapshot {
  planModeEnabled: boolean;
  sessionMode?: SessionMode;
  mcpServersEnabled?: Record<string, boolean>;
}

export function defaultWorkflowSettings(): WorkflowSettingsSnapshot {
  return { planModeEnabled: false };
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
      .get("plan_mode_enabled") as { key: string } | undefined;
    if (!row) {
      const legacyRow = this.db
        .prepare(`SELECT value_json FROM workflow_settings WHERE key = ?`)
        .get("orchestration_mode") as { value_json: string } | undefined;
      const migrated = snapshotFromStoredOrchestration(
        parseStoredOrchestration(legacyRow?.value_json),
      ).planModeEnabled;
      const now = new Date().toISOString();
      this.db
        .prepare(`INSERT INTO workflow_settings (key, value_json, updated_at) VALUES (?, ?, ?)`)
        .run("plan_mode_enabled", JSON.stringify(migrated), now);
    }
  }

  get(): WorkflowSettingsSnapshot {
    const planModeEnabled = this.readPlanModeEnabled();
    const mcpServersEnabled = this.readMcpServersEnabled();
    return {
      planModeEnabled,
      ...(mcpServersEnabled ? { mcpServersEnabled } : {}),
    };
  }

  save(snapshot: WorkflowSettingsSnapshot): WorkflowSettingsSnapshot {
    const normalized = normalizeWorkflowSettingsSnapshot(snapshot);
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO workflow_settings (key, value_json, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
      )
      .run("plan_mode_enabled", JSON.stringify(normalized.planModeEnabled), now);
    if (normalized.mcpServersEnabled) {
      this.db
        .prepare(
          `INSERT INTO workflow_settings (key, value_json, updated_at)
           VALUES (?, ?, ?)
           ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
        )
        .run("composer_mcp_servers_enabled", JSON.stringify(normalized.mcpServersEnabled), now);
    } else {
      this.db.prepare(`DELETE FROM workflow_settings WHERE key = ?`).run("composer_mcp_servers_enabled");
    }
    return this.get();
  }

  private readPlanModeEnabled(): boolean {
    const row = this.db
      .prepare(`SELECT value_json FROM workflow_settings WHERE key = ?`)
      .get("plan_mode_enabled") as { value_json: string } | undefined;
    if (row) {
      return snapshotFromStoredPlanMode(row.value_json).planModeEnabled;
    }
    const legacyRow = this.db
      .prepare(`SELECT value_json FROM workflow_settings WHERE key = ?`)
      .get("orchestration_mode") as { value_json: string } | undefined;
    return snapshotFromStoredOrchestration(parseStoredOrchestration(legacyRow?.value_json)).planModeEnabled;
  }

  private readMcpServersEnabled(): McpServersEnabledSettings | undefined {
    const row = this.db
      .prepare(`SELECT value_json FROM workflow_settings WHERE key = ?`)
      .get("composer_mcp_servers_enabled") as { value_json: string } | undefined;
    if (!row?.value_json?.trim()) {
      return undefined;
    }
    try {
      return normalizeMcpServersEnabled(JSON.parse(row.value_json) as unknown);
    } catch {
      return undefined;
    }
  }
}

export function orchestrationModeFromSnapshot(
  settings: WorkflowSettingsSnapshot,
): EcoOrchestrationMode {
  return settings.planModeEnabled ? "manual" : "autonomous";
}

export function usesPlanMode(settings: WorkflowSettingsSnapshot): boolean {
  return settings.planModeEnabled;
}

/** @deprecated Use usesPlanMode */
export function usesManualOrchestration(settings: WorkflowSettingsSnapshot): boolean {
  return usesPlanMode(settings);
}

/** @deprecated Use usesPlanMode */
export function usesPlanOrchestration(settings: WorkflowSettingsSnapshot): boolean {
  return usesPlanMode(settings);
}

function snapshotFromStoredOrchestration(mode: EcoOrchestrationMode): WorkflowSettingsSnapshot {
  return { planModeEnabled: mode === "manual" };
}

function snapshotFromStoredPlanMode(raw: string | undefined): WorkflowSettingsSnapshot {
  try {
    const parsed = JSON.parse(raw ?? "") as unknown;
    if (typeof parsed === "boolean") {
      return { planModeEnabled: parsed };
    }
  } catch {
    // ignore
  }
  return defaultWorkflowSettings();
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
  const mcpServersEnabled = normalizeMcpServersEnabled(record.mcpServersEnabled);
  const mcpPart = mcpServersEnabled ? { mcpServersEnabled } : {};
  if (typeof record.planModeEnabled === "boolean" || record.sessionMode !== undefined) {
    const synced = syncSessionModeFields({
      ...(typeof record.sessionMode === "string" ? { sessionMode: record.sessionMode as SessionMode } : {}),
      ...(typeof record.planModeEnabled === "boolean" ? { planModeEnabled: record.planModeEnabled } : {}),
    });
    return {
      planModeEnabled: synced.planModeEnabled,
      sessionMode: synced.sessionMode,
      ...mcpPart,
    };
  }
  if (record.orchestrationMode === "manual" || record.orchestrationMode === "autonomous") {
    const synced = syncSessionModeFields({
      planModeEnabled: record.orchestrationMode === "manual",
    });
    return {
      planModeEnabled: synced.planModeEnabled,
      sessionMode: synced.sessionMode,
      ...mcpPart,
    };
  }
  if (record.orchestrationMode === "analyze_plan_execute") {
    return { planModeEnabled: true, sessionMode: "plan", ...mcpPart };
  }
  if (record.orchestrationMode === "sdk_default") {
    return { planModeEnabled: false, sessionMode: "agent", ...mcpPart };
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
  if (
    record.sessionMode === "agent" ||
    record.sessionMode === "plan" ||
    record.sessionMode === "ask"
  ) {
    return true;
  }
  if (record.orchestrationMode === "manual" || record.orchestrationMode === "autonomous") {
    return true;
  }
  if (record.orchestrationMode === "analyze_plan_execute" || record.orchestrationMode === "sdk_default") {
    return true;
  }
  return false;
}
