import fs from "node:fs/promises";
import path from "node:path";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";
import type {
  CommitMessageModelPreference,
  CommitMessageRolePreference,
} from "../shared/resolve-commit-message-route";

const COMMIT_MESSAGE_INSTRUCTIONS_MAX_CHARS = 2_000;

export interface GitSettingsSnapshot {
  commitMessageRoleByMainAgentConfigId: Record<string, CommitMessageRolePreference>;
  commitMessageCandidateModelIdByMainAgentConfigId: Record<string, CommitMessageModelPreference>;
  commitMessageInstructions?: string;
  /** 窗口聚焦且仓库空闲时周期性 git fetch，对齐 VS Code git.autofetch */
  autofetch?: boolean;
  /** 自动 fetch 间隔（秒），默认 180 */
  autofetchPeriod?: number;
}

export function defaultGitSettings(): GitSettingsSnapshot {
  return {
    commitMessageRoleByMainAgentConfigId: {},
    commitMessageCandidateModelIdByMainAgentConfigId: {},
    autofetch: true,
    autofetchPeriod: 180,
  };
}

export async function createGitSettingsStore(dbPath: string): Promise<GitSettingsStore> {
  await fs.mkdir(path.dirname(dbPath), { recursive: true });
  const sqlite = await import("node:sqlite");
  const store = new GitSettingsStore(new sqlite.DatabaseSync(dbPath));
  store.initialize();
  return store;
}

export class GitSettingsStore {
  constructor(private readonly db: DatabaseSyncType) {}

  initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS git_settings (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  }

  get(): GitSettingsSnapshot {
    const row = this.db.prepare(`SELECT value_json FROM git_settings WHERE key = ?`).get("snapshot") as
      | { value_json: string }
      | undefined;
    if (!row) {
      return defaultGitSettings();
    }
    try {
      return normalizeGitSettingsSnapshot(JSON.parse(row.value_json));
    } catch {
      return defaultGitSettings();
    }
  }

  save(snapshot: GitSettingsSnapshot): GitSettingsSnapshot {
    const normalized = normalizeGitSettingsSnapshot(snapshot);
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO git_settings (key, value_json, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
      )
      .run("snapshot", JSON.stringify(normalized), now);
    return this.get();
  }

  getCommitMessageRoleForMainAgentConfig(mainAgentConfigId: string): CommitMessageRolePreference {
    const settings = this.get();
    return settings.commitMessageRoleByMainAgentConfigId[mainAgentConfigId] ?? "auto";
  }

  getCommitMessageCandidateModelIdForMainAgentConfig(
    mainAgentConfigId: string,
  ): CommitMessageModelPreference {
    const settings = this.get();
    return settings.commitMessageCandidateModelIdByMainAgentConfigId[mainAgentConfigId] ?? "auto";
  }

  saveCommitMessageRoleForMainAgentConfig(
    mainAgentConfigId: string,
    role: CommitMessageRolePreference,
    availableRoles: ReadonlySet<string>,
  ): GitSettingsSnapshot {
    const settings = this.get();
    const nextRole = role === "auto" || availableRoles.has(role) ? role : ("auto" as const);
    return this.save({
      ...settings,
      commitMessageRoleByMainAgentConfigId: {
        ...settings.commitMessageRoleByMainAgentConfigId,
        [mainAgentConfigId]: nextRole,
      },
    });
  }

  saveCommitMessageCandidateModelIdForMainAgentConfig(
    mainAgentConfigId: string,
    candidateModelId: CommitMessageModelPreference,
    availableCandidateModelIds: ReadonlySet<string>,
  ): GitSettingsSnapshot {
    const settings = this.get();
    const nextId =
      candidateModelId === "auto" || availableCandidateModelIds.has(candidateModelId)
        ? candidateModelId
        : ("auto" as const);
    return this.save({
      ...settings,
      commitMessageCandidateModelIdByMainAgentConfigId: {
        ...settings.commitMessageCandidateModelIdByMainAgentConfigId,
        [mainAgentConfigId]: nextId,
      },
    });
  }
}

export function normalizeGitSettingsSnapshot(value: unknown): GitSettingsSnapshot {
  if (!value || typeof value !== "object") {
    return defaultGitSettings();
  }
  const record = value as Record<string, unknown>;
  const commitMessageRoleByMainAgentConfigId = normalizeRolePreferenceMap(
    record.commitMessageRoleByMainAgentConfigId,
  );
  const commitMessageCandidateModelIdByMainAgentConfigId = normalizeCandidateModelPreferenceMap(
    record.commitMessageCandidateModelIdByMainAgentConfigId,
  );
  const instructions = normalizeCommitMessageInstructions(record.commitMessageInstructions);
  const autofetch = normalizeAutofetch(record.autofetch);
  const autofetchPeriod = normalizeAutofetchPeriod(record.autofetchPeriod);
  return {
    commitMessageRoleByMainAgentConfigId,
    commitMessageCandidateModelIdByMainAgentConfigId,
    ...(instructions && { commitMessageInstructions: instructions }),
    autofetch,
    autofetchPeriod,
  };
}

function normalizeRolePreferenceMap(value: unknown): Record<string, CommitMessageRolePreference> {
  if (!value || typeof value !== "object") {
    return {};
  }
  const commitMessageRoleByMainAgentConfigId: Record<string, CommitMessageRolePreference> = {};
  for (const [mainAgentConfigId, role] of Object.entries(value)) {
    if (typeof mainAgentConfigId !== "string" || !mainAgentConfigId.trim()) {
      continue;
    }
    if (role === "auto" || (typeof role === "string" && role.trim())) {
      commitMessageRoleByMainAgentConfigId[mainAgentConfigId] = role === "auto" ? "auto" : role.trim();
    }
  }
  return commitMessageRoleByMainAgentConfigId;
}

function normalizeCandidateModelPreferenceMap(value: unknown): Record<string, CommitMessageModelPreference> {
  if (!value || typeof value !== "object") {
    return {};
  }
  const commitMessageCandidateModelIdByMainAgentConfigId: Record<string, CommitMessageModelPreference> = {};
  for (const [mainAgentConfigId, candidateModelId] of Object.entries(value)) {
    if (typeof mainAgentConfigId !== "string" || !mainAgentConfigId.trim()) {
      continue;
    }
    if (candidateModelId === "auto" || (typeof candidateModelId === "string" && candidateModelId.trim())) {
      commitMessageCandidateModelIdByMainAgentConfigId[mainAgentConfigId] =
        candidateModelId === "auto" ? "auto" : candidateModelId.trim();
    }
  }
  return commitMessageCandidateModelIdByMainAgentConfigId;
}

function normalizeAutofetch(value: unknown): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  return true;
}

function normalizeAutofetchPeriod(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value) && value >= 30) {
    return Math.floor(value);
  }
  return 180;
}

function normalizeCommitMessageInstructions(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  if (trimmed.length > COMMIT_MESSAGE_INSTRUCTIONS_MAX_CHARS) {
    return trimmed.slice(0, COMMIT_MESSAGE_INSTRUCTIONS_MAX_CHARS);
  }
  return trimmed;
}

export function isGitSettingsSnapshot(value: unknown): value is GitSettingsSnapshot {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  const rawRoles = record.commitMessageRoleByMainAgentConfigId;
  const rawCandidates = record.commitMessageCandidateModelIdByMainAgentConfigId;
  if (rawRoles !== undefined && (typeof rawRoles !== "object" || rawRoles === null)) {
    return false;
  }
  if (rawCandidates !== undefined && (typeof rawCandidates !== "object" || rawCandidates === null)) {
    return false;
  }
  return true;
}
