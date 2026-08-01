import fs from "node:fs/promises";
import path from "node:path";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";
import {
  DEFAULT_GLOBAL_CONTEXT_WINDOW_LIMIT,
  type CoreKind,
  type EcoOrchestrationMode,
  isCoreKind,
  isGlobalContextWindowLimit,
  normalizeGlobalContextWindowLimit,
} from "@eco/runtime";
import { type McpServersEnabledSettings, normalizeMcpServersEnabled } from "../shared/composer-mcp";
import { isSessionMode, normalizeSessionMode, type SessionMode } from "../shared/session-mode";
import type { OrchestrationSelection } from "../shared/agent-orchestration";
import { isOrchestrationSelection } from "../shared/agent-orchestration";
import {
  isAuxiliaryModelSelection,
  normalizeAuxiliaryModelSelection,
  type AuxiliaryModelSelection,
} from "../shared/auxiliary-model";
import {
  isVisionModelSelection,
  normalizeVisionModelSelection,
  type VisionModelSelection,
} from "../shared/vision-model";

export type { SessionMode };

export interface WorkflowSettingsSnapshot {
  sessionMode: SessionMode;
  defaultCoreKind?: CoreKind;
  contextWindowLimitTokens: number;
  defaultOrchestrationSelection?: OrchestrationSelection;
  defaultAuxiliaryModel?: AuxiliaryModelSelection;
  defaultVisionModel?: VisionModelSelection;
  mcpServersEnabled?: Record<string, boolean>;
}

export function defaultWorkflowSettings(): WorkflowSettingsSnapshot {
  return {
    sessionMode: "agent",
    defaultCoreKind: "claude",
    contextWindowLimitTokens: DEFAULT_GLOBAL_CONTEXT_WINDOW_LIMIT,
  };
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
    const contextWindowLimitTokens = this.readContextWindowLimitTokens();
    const defaultOrchestrationSelection = this.readDefaultOrchestrationSelection();
    const defaultAuxiliaryModel = this.readDefaultAuxiliaryModel();
    const defaultVisionModel = this.readDefaultVisionModel();
    const mcpServersEnabled = this.readMcpServersEnabled();
    return {
      sessionMode,
      defaultCoreKind,
      contextWindowLimitTokens,
      ...(defaultOrchestrationSelection ? { defaultOrchestrationSelection } : {}),
      ...(defaultAuxiliaryModel ? { defaultAuxiliaryModel } : {}),
      ...(defaultVisionModel ? { defaultVisionModel } : {}),
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
    this.db
      .prepare(
        `INSERT INTO workflow_settings (key, value_json, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
      )
      .run("context_window_limit_tokens", JSON.stringify(normalized.contextWindowLimitTokens), now);
    if (normalized.defaultOrchestrationSelection) {
      this.db
        .prepare(
          `INSERT INTO workflow_settings (key, value_json, updated_at)
           VALUES (?, ?, ?)
           ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
        )
        .run(
          "default_orchestration_selection",
          JSON.stringify(normalized.defaultOrchestrationSelection),
          now,
        );
    } else {
      this.db.prepare(`DELETE FROM workflow_settings WHERE key = ?`).run("default_orchestration_selection");
    }
    if (normalized.defaultAuxiliaryModel) {
      this.db
        .prepare(
          `INSERT INTO workflow_settings (key, value_json, updated_at)
           VALUES (?, ?, ?)
           ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
        )
        .run("default_auxiliary_model", JSON.stringify(normalized.defaultAuxiliaryModel), now);
    } else {
      this.db.prepare(`DELETE FROM workflow_settings WHERE key = ?`).run("default_auxiliary_model");
    }
    if (normalized.defaultVisionModel) {
      this.db
        .prepare(
          `INSERT INTO workflow_settings (key, value_json, updated_at)
           VALUES (?, ?, ?)
           ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
        )
        .run("default_vision_model", JSON.stringify(normalized.defaultVisionModel), now);
    } else {
      this.db.prepare(`DELETE FROM workflow_settings WHERE key = ?`).run("default_vision_model");
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

  clearDefaultSubagentOrchestrationReference(orchestrationId: string): boolean {
    const trimmedId = orchestrationId.trim();
    const selection = this.readDefaultOrchestrationSelection();
    if (
      !trimmedId ||
      !selection ||
      selection.subagents.mode !== "orchestration" ||
      selection.subagents.orchestrationId !== trimmedId
    ) {
      return false;
    }
    this.save({
      ...this.get(),
      defaultOrchestrationSelection: { ...selection, subagents: { mode: "none" } },
    });
    return true;
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

  private readContextWindowLimitTokens(): number {
    const row = this.db
      .prepare(`SELECT value_json FROM workflow_settings WHERE key = ?`)
      .get("context_window_limit_tokens") as { value_json: string } | undefined;
    if (!row?.value_json?.trim()) {
      return DEFAULT_GLOBAL_CONTEXT_WINDOW_LIMIT;
    }
    try {
      return normalizeGlobalContextWindowLimit(JSON.parse(row.value_json) as unknown);
    } catch {
      return DEFAULT_GLOBAL_CONTEXT_WINDOW_LIMIT;
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

  private readDefaultOrchestrationSelection(): OrchestrationSelection | undefined {
    const row = this.db
      .prepare(`SELECT value_json FROM workflow_settings WHERE key = ?`)
      .get("default_orchestration_selection") as { value_json: string } | undefined;
    if (!row?.value_json?.trim()) {
      return undefined;
    }
    try {
      const parsed = JSON.parse(row.value_json) as unknown;
      return isOrchestrationSelection(parsed) ? parsed : undefined;
    } catch {
      return undefined;
    }
  }

  private readDefaultAuxiliaryModel(): AuxiliaryModelSelection | undefined {
    const row = this.db
      .prepare(`SELECT value_json FROM workflow_settings WHERE key = ?`)
      .get("default_auxiliary_model") as { value_json: string } | undefined;
    if (!row?.value_json?.trim()) {
      return undefined;
    }
    try {
      return normalizeAuxiliaryModelSelection(JSON.parse(row.value_json) as unknown);
    } catch {
      return undefined;
    }
  }

  private readDefaultVisionModel(): VisionModelSelection | undefined {
    const row = this.db
      .prepare(`SELECT value_json FROM workflow_settings WHERE key = ?`)
      .get("default_vision_model") as { value_json: string } | undefined;
    if (!row?.value_json?.trim()) {
      return undefined;
    }
    try {
      return normalizeVisionModelSelection(JSON.parse(row.value_json) as unknown);
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
  const contextWindowLimitTokens = normalizeGlobalContextWindowLimit(record.contextWindowLimitTokens);
  const defaultOrchestrationSelection = isOrchestrationSelection(record.defaultOrchestrationSelection)
    ? record.defaultOrchestrationSelection
    : undefined;
  const defaultAuxiliaryModel = normalizeAuxiliaryModelSelection(record.defaultAuxiliaryModel);
  const defaultVisionModel = normalizeVisionModelSelection(record.defaultVisionModel);
  const mcpServersEnabled = normalizeMcpServersEnabled(record.mcpServersEnabled);
  const mcpPart = mcpServersEnabled ? { mcpServersEnabled } : {};
  const defaultOrchestrationPart = defaultOrchestrationSelection
    ? { defaultOrchestrationSelection }
    : {};
  const defaultAuxiliaryPart = defaultAuxiliaryModel ? { defaultAuxiliaryModel } : {};
  const defaultVisionPart = defaultVisionModel ? { defaultVisionModel } : {};
  if (isSessionMode(record.sessionMode)) {
    return {
      sessionMode: record.sessionMode,
      defaultCoreKind,
      contextWindowLimitTokens,
      ...defaultOrchestrationPart,
      ...defaultAuxiliaryPart,
      ...defaultVisionPart,
      ...mcpPart,
    };
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
    (record.contextWindowLimitTokens === undefined ||
      isGlobalContextWindowLimit(record.contextWindowLimitTokens)) &&
    (record.defaultOrchestrationSelection === undefined ||
      isOrchestrationSelection(record.defaultOrchestrationSelection)) &&
    (record.defaultAuxiliaryModel === undefined ||
      isAuxiliaryModelSelection(record.defaultAuxiliaryModel)) &&
    (record.defaultVisionModel === undefined || isVisionModelSelection(record.defaultVisionModel))
  );
}
