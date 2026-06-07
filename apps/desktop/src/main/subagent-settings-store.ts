import fs from "node:fs/promises";
import path from "node:path";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";
import {
  SUBAGENT_ROLES,
  defaultSubagentAvailability,
  normalizeSubagentAvailability,
  type SubagentAvailability,
  type SubagentRole,
} from "@eco/runtime";
import type { SubagentEnabledSettings } from "../shared/ipc";

interface SubagentEnabledRow {
  role: SubagentRole;
  enabled: number;
  updated_at: string;
}

export function emptySubagentEnabledSettings(): SubagentEnabledSettings {
  return { ...defaultSubagentAvailability() };
}

export async function createSubagentSettingsStore(dbPath: string): Promise<SubagentSettingsStore> {
  await fs.mkdir(path.dirname(dbPath), { recursive: true });
  const sqlite = await import("node:sqlite");
  const store = new SubagentSettingsStore(new sqlite.DatabaseSync(dbPath));
  store.initialize();
  return store;
}

export class SubagentSettingsStore {
  constructor(private readonly db: DatabaseSyncType) {}

  initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS subagent_enabled (
        role TEXT PRIMARY KEY,
        enabled INTEGER NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);

    const existing = new Set(this.listRoles());
    const now = new Date().toISOString();
    for (const role of SUBAGENT_ROLES) {
      if (!existing.has(role)) {
        this.db
          .prepare(`INSERT INTO subagent_enabled (role, enabled, updated_at) VALUES (?, ?, ?)`)
          .run(role, 1, now);
      }
    }
  }

  get(): SubagentEnabledSettings {
    const rows = this.db
      .prepare(`SELECT role, enabled FROM subagent_enabled`)
      .all() as unknown as SubagentEnabledRow[];

    const partial: Partial<Record<SubagentRole, boolean>> = {};
    for (const row of rows) {
      if (!SUBAGENT_ROLES.includes(row.role)) {
        continue;
      }
      partial[row.role] = row.enabled !== 0;
    }
    return normalizeSubagentAvailability(partial);
  }

  save(settings: SubagentEnabledSettings): SubagentEnabledSettings {
    const normalized = normalizeSubagentAvailability(settings);
    const now = new Date().toISOString();
    const statement = this.db.prepare(
      `INSERT INTO subagent_enabled (role, enabled, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(role) DO UPDATE SET enabled = excluded.enabled, updated_at = excluded.updated_at`,
    );

    for (const role of SUBAGENT_ROLES) {
      statement.run(role, normalized[role] ? 1 : 0, now);
    }

    return this.get();
  }

  private listRoles(): SubagentRole[] {
    const rows = this.db.prepare(`SELECT role FROM subagent_enabled`).all() as { role: string }[];
    return rows.map((row) => row.role).filter((role): role is SubagentRole => SUBAGENT_ROLES.includes(role as SubagentRole));
  }
}

export function isSubagentEnabledSettings(value: unknown): value is SubagentEnabledSettings {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return SUBAGENT_ROLES.every((role) => typeof record[role] === "boolean");
}
