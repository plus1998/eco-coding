import fs from "node:fs/promises";
import path from "node:path";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";
import type { EcoOrchestrationMode } from "@eco/runtime";
import {
  normalizeMcpServersEnabled,
  type McpServersEnabledSettings,
} from "../shared/composer-mcp";
import { isSessionMode, normalizeSessionMode, type SessionMode } from "../shared/session-mode";

export type { SessionMode };

export interface WorkflowSettingsSnapshot {
  sessionMode: SessionMode;
  mcpServersEnabled?: Record<string, boolean>;
}

export function defaultWorkflowSettings(): WorkflowSettingsSnapshot {
  return { sessionMode: "agent" };
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
  }

  get(): WorkflowSettingsSnapshot {
    const sessionMode = this.readSessionMode();
    const mcpServersEnabled = this.readMcpServersEnabled();
    return {
      sessionMode,
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
      .run("session_mode", JSON.stringify(normalized.sessionMode), now);
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

  private readSessionMode(): SessionMode {
    const row = this.db
      .prepare(`SELECT value_json FROM workflow_settings WHERE key = ?`)
      .get("session_mode") as { value_json: string } | undefined;
    if (!row) {
      return "agent";
    }
    try {
      const parsed = JSON.parse(row.value_json) as unknown;
      if (isSessionMode(parsed)) {
        return parsed;
      }
      if (parsed && typeof parsed === "object") {
        const record = parsed as Record<string, unknown>;
        if (isSessionMode(record.sessionMode)) {
          return record.sessionMode;
        }
      }
    } catch {
      // ignore
    }
    return normalizeSessionMode(row.value_json);
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
  return settings.sessionMode === "plan" ? "manual" : "autonomous";
}

export function usesPlanMode(settings: WorkflowSettingsSnapshot): boolean {
  return settings.sessionMode === "plan";
}

/** @deprecated Use usesPlanMode */
export function usesManualOrchestration(settings: WorkflowSettingsSnapshot): boolean {
  return usesPlanMode(settings);
}

/** @deprecated Use usesPlanMode */
export function usesPlanOrchestration(settings: WorkflowSettingsSnapshot): boolean {
  return usesPlanMode(settings);
}

export function normalizeWorkflowSettingsSnapshot(value: unknown): WorkflowSettingsSnapshot {
  if (!value || typeof value !== "object") {
    return defaultWorkflowSettings();
  }
  const record = value as Record<string, unknown>;
  const mcpServersEnabled = normalizeMcpServersEnabled(record.mcpServersEnabled);
  const mcpPart = mcpServersEnabled ? { mcpServersEnabled } : {};
  if (isSessionMode(record.sessionMode)) {
    return { sessionMode: record.sessionMode, ...mcpPart };
  }
  return defaultWorkflowSettings();
}

export function isWorkflowSettingsSnapshot(value: unknown): value is WorkflowSettingsSnapshot {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return isSessionMode(record.sessionMode);
}
