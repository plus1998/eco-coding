import fs from "node:fs/promises";
import path from "node:path";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";
import type { CommitMessageRolePreference } from "../shared/resolve-commit-message-route";
import type { RuntimeAgentRole } from "../shared/ipc";

const COMMIT_MESSAGE_INSTRUCTIONS_MAX_CHARS = 2_000;

export interface GitSettingsSnapshot {
  commitMessageRoleByProfileId: Record<string, CommitMessageRolePreference>;
  commitMessageInstructions?: string;
}

export function defaultGitSettings(): GitSettingsSnapshot {
  return { commitMessageRoleByProfileId: {} };
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
    const row = this.db
      .prepare(`SELECT value_json FROM git_settings WHERE key = ?`)
      .get("snapshot") as { value_json: string } | undefined;
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

  getCommitMessageRoleForProfile(profileId: string): CommitMessageRolePreference {
    const settings = this.get();
    return settings.commitMessageRoleByProfileId[profileId] ?? "auto";
  }

  saveCommitMessageRoleForProfile(
    profileId: string,
    role: CommitMessageRolePreference,
    availableRoles: ReadonlySet<RuntimeAgentRole>,
  ): GitSettingsSnapshot {
    const settings = this.get();
    const nextRole =
      role === "auto" || availableRoles.has(role) ? role : ("auto" as const);
    return this.save({
      commitMessageRoleByProfileId: {
        ...settings.commitMessageRoleByProfileId,
        [profileId]: nextRole,
      },
    });
  }
}

export function normalizeGitSettingsSnapshot(value: unknown): GitSettingsSnapshot {
  if (!value || typeof value !== "object") {
    return defaultGitSettings();
  }
  const record = value as Record<string, unknown>;
  const raw = record.commitMessageRoleByProfileId;
  if (!raw || typeof raw !== "object") {
    return defaultGitSettings();
  }
  const commitMessageRoleByProfileId: Record<string, CommitMessageRolePreference> = {};
  for (const [profileId, role] of Object.entries(raw)) {
    if (typeof profileId !== "string" || !profileId.trim()) {
      continue;
    }
    if (role === "auto" || (typeof role === "string" && role.trim())) {
      commitMessageRoleByProfileId[profileId] = role === "auto" ? "auto" : role.trim();
    }
  }
  const instructions = normalizeCommitMessageInstructions(record.commitMessageInstructions);
  return {
    commitMessageRoleByProfileId,
    ...(instructions && { commitMessageInstructions: instructions }),
  };
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
  const raw = record.commitMessageRoleByProfileId;
  if (!raw || typeof raw !== "object") {
    return false;
  }
  return true;
}
