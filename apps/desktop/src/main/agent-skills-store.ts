import fs from "node:fs/promises";
import path from "node:path";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";
import { AGENT_ROLES, type AgentRole, type AgentSkillAssignments } from "../shared/ipc";

interface AgentSkillsRow {
  role: AgentRole;
  skills_json: string;
  updated_at: string;
}

export function emptyAgentSkillAssignments(): AgentSkillAssignments {
  return Object.fromEntries(AGENT_ROLES.map((role) => [role, []])) as AgentSkillAssignments;
}

export async function createAgentSkillsStore(dbPath: string): Promise<AgentSkillsStore> {
  await fs.mkdir(path.dirname(dbPath), { recursive: true });
  const sqlite = await import("node:sqlite");
  const store = new AgentSkillsStore(new sqlite.DatabaseSync(dbPath));
  store.initialize();
  return store;
}

export class AgentSkillsStore {
  constructor(private readonly db: DatabaseSyncType) {}

  initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS agent_skill_assignments (
        role TEXT PRIMARY KEY,
        skills_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);

    const existing = new Set(this.listRoles());
    const now = new Date().toISOString();
    for (const role of AGENT_ROLES) {
      if (!existing.has(role)) {
        this.db
          .prepare(
            `INSERT INTO agent_skill_assignments (role, skills_json, updated_at) VALUES (?, ?, ?)`,
          )
          .run(role, "[]", now);
      }
    }
  }

  getAssignments(): AgentSkillAssignments {
    const rows = this.db
      .prepare(`SELECT role, skills_json FROM agent_skill_assignments`)
      .all() as AgentSkillsRow[];

    const assignments = emptyAgentSkillAssignments();
    for (const row of rows) {
      if (!AGENT_ROLES.includes(row.role)) {
        continue;
      }
      assignments[row.role] = parseSkillsJson(row.skills_json);
    }
    return assignments;
  }

  saveAssignments(
    assignments: AgentSkillAssignments,
    allowedSkillNames?: ReadonlySet<string>,
  ): AgentSkillAssignments {
    const now = new Date().toISOString();
    const statement = this.db.prepare(
      `INSERT INTO agent_skill_assignments (role, skills_json, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(role) DO UPDATE SET skills_json = excluded.skills_json, updated_at = excluded.updated_at`,
    );

    for (const role of AGENT_ROLES) {
      let skills = normalizeSkillList(assignments[role]);
      if (allowedSkillNames) {
        skills = skills.filter((name) => allowedSkillNames.has(name));
      }
      statement.run(role, JSON.stringify(skills), now);
    }

    return this.getAssignments();
  }

  private listRoles(): AgentRole[] {
    const rows = this.db.prepare(`SELECT role FROM agent_skill_assignments`).all() as {
      role: string;
    }[];
    return rows.map((row) => row.role).filter((role): role is AgentRole => AGENT_ROLES.includes(role as AgentRole));
  }
}

function parseSkillsJson(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return normalizeSkillList(parsed.filter((entry): entry is string => typeof entry === "string"));
  } catch {
    return [];
  }
}

function normalizeSkillList(skills: readonly string[] | undefined): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const skill of skills ?? []) {
    const trimmed = skill.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    normalized.push(trimmed);
  }
  return normalized;
}
