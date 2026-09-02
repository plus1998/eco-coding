import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { resolveDevUserDataSuffix } from "../../src/main/desktop-dev-user-data-suffix";

const UNPACKAGED_USER_DATA_BASENAME = "@eco/desktop";

export function resolveUnpackagedUserDataDir(configuredSuffix?: string): string {
  const suffix = resolveDevUserDataSuffix(configuredSuffix ?? process.env.ECO_DEV_USER_DATA_SUFFIX ?? "E2E");
  const base =
    process.platform === "darwin"
      ? join(homedir(), "Library", "Application Support", UNPACKAGED_USER_DATA_BASENAME)
      : process.platform === "win32"
        ? join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), UNPACKAGED_USER_DATA_BASENAME)
        : join(homedir(), ".config", UNPACKAGED_USER_DATA_BASENAME);
  return base + suffix;
}

export function resolveE2eDatabasePath(): string {
  const configured = process.env.ECO_DATABASE_PATH?.trim();
  if (configured) {
    return configured;
  }
  return join(resolveUnpackagedUserDataDir(), "eco-coding.sqlite");
}

export interface FeedSkeletonRow {
  threadId: string;
  historyRevision: number;
  maxEventSequence: number;
  timelineIds: string[];
  hasAuxiliary: boolean;
}

export function readFeedSkeletonRow(databasePath: string, threadId: string): FeedSkeletonRow | undefined {
  if (!existsSync(databasePath)) {
    return undefined;
  }
  const db = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const row = db
      .prepare(
        `SELECT thread_id, history_revision, max_event_sequence, snapshot_json, auxiliary_json
         FROM thread_feed_skeleton
         WHERE thread_id = ?`,
      )
      .get(threadId) as
      | {
          thread_id: string;
          history_revision: number;
          max_event_sequence: number;
          snapshot_json: string;
          auxiliary_json: string | null;
        }
      | undefined;
    if (!row?.snapshot_json?.trim()) {
      return undefined;
    }
    const snapshot = JSON.parse(row.snapshot_json) as { timeline?: Array<{ id: string }> };
    return {
      threadId: row.thread_id,
      historyRevision: row.history_revision,
      maxEventSequence: row.max_event_sequence,
      timelineIds: (snapshot.timeline ?? []).map((item) => item.id),
      hasAuxiliary: Boolean(row.auxiliary_json?.trim()),
    };
  } finally {
    db.close();
  }
}

export function readMaxRunEventSequence(databasePath: string, threadId: string): number {
  if (!existsSync(databasePath)) {
    return 0;
  }
  const db = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const row = db
      .prepare(`SELECT COALESCE(MAX(sequence), 0) AS max_sequence FROM thread_run_events WHERE thread_id = ?`)
      .get(threadId) as { max_sequence: number } | undefined;
    return row?.max_sequence ?? 0;
  } finally {
    db.close();
  }
}

export function resolveE2eProfileHint(): string {
  const suffix = process.env.ECO_DEV_USER_DATA_SUFFIX ?? "E2E";
  if (suffix === "E2E") {
    return `Fresh E2E profile (${suffix}) has no threads. Re-run with ECO_DEV_USER_DATA_SUFFIX=Dev or ECO_DATABASE_PATH.`;
  }
  return `No threads with run events in profile suffix ${suffix}.`;
}
