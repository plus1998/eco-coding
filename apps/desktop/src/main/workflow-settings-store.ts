import fs from "node:fs/promises";
import path from "node:path";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";
import { type CoreKind, type EcoOrchestrationMode, isCoreKind } from "@eco/runtime";
import { type McpServersEnabledSettings, normalizeMcpServersEnabled } from "../shared/composer-mcp";
import { isSessionMode, normalizeSessionMode, type SessionMode } from "../shared/session-mode";

export type { SessionMode };

export interface WorkflowSettingsSnapshot {
  sessionMode: SessionMode;
  defaultCoreKind?: CoreKind;
  defaultAgentProfileId?: string;
  mcpServersEnabled?: Record<string, boolean>;
}

export function defaultWorkflowSettings(): WorkflowSettingsSnapshot {
  return { sessionMode: "agent", defaultCoreKind: "claude" };
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
    const defaultCoreKind = this.readDefaultCoreKind();
    const defaultAgentProfileId = this.readDefaultAgentProfileId();
    const mcpServersEnabled = this.readMcpServersEnabled();
    return {
      sessionMode,
      defaultCoreKind,
      ...(defaultAgentProfileId ? { defaultAgentProfileId } : {}),
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
    this.db
      .prepare(
        `INSERT INTO workflow_settings (key, value_json, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
      )
      .run("default_core_kind", JSON.stringify(normalized.defaultCoreKind ?? "claude"), now);
    if (normalized.defaultAgentProfileId) {
      this.db
        .prepare(
          `INSERT INTO workflow_settings (key, value_json, updated_at)
           VALUES (?, ?, ?)
           ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
        )
        .run("default_agent_profile_id", JSON.stringify(normalized.defaultAgentProfileId), now);
    } else {
      this.db.prepare(`DELETE FROM workflow_settings WHERE key = ?`).run("default_agent_profile_id");
    }
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

  private readDefaultCoreKind(): CoreKind {
    const row = this.db
      .prepare(`SELECT value_json FROM workflow_settings WHERE key = ?`)
      .get("default_core_kind") as { value_json: string } | undefined;
    if (!row?.value_json?.trim()) {
      return "claude";
    }
    try {
      const parsed = JSON.parse(row.value_json) as unknown;
      return isCoreKind(parsed) ? parsed : "claude";
    } catch {
      return "claude";
    }
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

  private readDefaultAgentProfileId(): string | undefined {
    const row = this.db
      .prepare(`SELECT value_json FROM workflow_settings WHERE key = ?`)
      .get("default_agent_profile_id") as { value_json: string } | undefined;
    if (!row?.value_json?.trim()) {
      return undefined;
    }
    try {
      const parsed = JSON.parse(row.value_json) as unknown;
      return typeof parsed === "string" && parsed.trim() ? parsed.trim() : undefined;
    } catch {
      return undefined;
    }
  }
}

export function orchestrationModeFromSnapshot(settings: WorkflowSettingsSnapshot): EcoOrchestrationMode {
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
  const defaultCoreKind = isCoreKind(record.defaultCoreKind) ? record.defaultCoreKind : "claude";
  const defaultAgentProfileId =
    typeof record.defaultAgentProfileId === "string" && record.defaultAgentProfileId.trim()
      ? record.defaultAgentProfileId.trim()
      : undefined;
  const mcpServersEnabled = normalizeMcpServersEnabled(record.mcpServersEnabled);
  const mcpPart = mcpServersEnabled ? { mcpServersEnabled } : {};
  const defaultAgentPart = defaultAgentProfileId ? { defaultAgentProfileId } : {};
  if (isSessionMode(record.sessionMode)) {
    return { sessionMode: record.sessionMode, defaultCoreKind, ...defaultAgentPart, ...mcpPart };
  }
  return defaultWorkflowSettings();
}

export function isWorkflowSettingsSnapshot(value: unknown): value is WorkflowSettingsSnapshot {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    isSessionMode(record.sessionMode) &&
    (record.defaultCoreKind === undefined || isCoreKind(record.defaultCoreKind)) &&
    (record.defaultAgentProfileId === undefined || typeof record.defaultAgentProfileId === "string")
  );
}
