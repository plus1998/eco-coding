import type { OrchestrationProfile } from "./agent-orchestration";

export type SkillSource = "user" | "project";
export type SkillLayout = "claude" | "agents";

export const CLAUDE_SKILLS_REL = ".claude/skills" as const;
export const AGENTS_SKILLS_REL = ".agents/skills" as const;

export const USER_SKILL_ROOTS = [CLAUDE_SKILLS_REL, AGENTS_SKILLS_REL] as const;
export const PROJECT_SKILL_ROOTS = [...USER_SKILL_ROOTS] as const;

export interface SkillInfo {
  name: string;
  description: string;
  source: SkillSource;
  /** Directory containing SKILL.md */
  directory: string;
  skillFilePath: string;
  layout: SkillLayout;
  /** True when Claude Agent SDK can load this skill (.claude path or symlink). */
  sdkReady: boolean;
  /** Project directory layer containing .claude / .agents (user skills: homedir). */
  baseDir?: string;
}

export interface SkillsListResult {
  workspacePath?: string;
  userSkills: SkillInfo[];
  projectSkills: SkillInfo[];
  agentsOnlySkills: SkillInfo[];
  scannedAt: string;
}

export interface LinkAgentsSkillsRequest {
  workspacePath: string;
  /** When set, only link skills under this base directory layer. */
  baseDir?: string;
}

export interface LinkAgentsSkillsSkipped {
  name: string;
  baseDir: string;
  reason: string;
}

export interface LinkAgentsSkillsResult {
  created: Array<{ name: string; baseDir: string; linkPath: string }>;
  skipped: LinkAgentsSkillsSkipped[];
  errors: string[];
}

/** One entry per skill name; prefers `.claude` layout when both exist. */
export function dedupeSkillsByName(skills: readonly SkillInfo[]): SkillInfo[] {
  const byName = new Map<string, SkillInfo>();
  for (const skill of skills) {
    const existing = byName.get(skill.name);
    if (!existing) {
      byName.set(skill.name, skill);
      continue;
    }
    if (skill.layout === "claude" && existing.layout !== "claude") {
      byName.set(skill.name, skill);
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function listSdkReadyProjectSkills(skills: readonly SkillInfo[]): SkillInfo[] {
  return dedupeSkillsByName(
    skills.filter((skill) => skill.source === "project" && skill.sdkReady),
  );
}

export const SKILL_NAME_TOKEN = /\$([a-zA-Z0-9][a-zA-Z0-9_-]*)/g;

/** Skill names from Codex-style `$skill-name` tokens in a prompt. */
export function parseExplicitSkillNames(prompt: string | undefined): string[] {
  if (!prompt?.trim()) {
    return [];
  }
  const names: string[] = [];
  const seen = new Set<string>();
  for (const match of prompt.matchAll(SKILL_NAME_TOKEN)) {
    const name = match[1];
    if (!name || seen.has(name)) {
      continue;
    }
    seen.add(name);
    names.push(name);
  }
  return names;
}

export function promptIncludesSkillName(prompt: string | undefined, skillName: string): boolean {
  return parseExplicitSkillNames(prompt).includes(skillName);
}

/** `$name` tokens that match discovered user-level skills (sdk-ready only). */
export function filterExplicitUserSkillNames(
  prompt: string | undefined,
  userSkills: readonly Pick<SkillInfo, "name" | "sdkReady">[],
): string[] {
  const allowed = new Set(
    userSkills.filter((skill) => skill.sdkReady).map((skill) => skill.name),
  );
  return parseExplicitSkillNames(prompt).filter((name) => allowed.has(name));
}

export type SdkSessionSkillsScope = "planning" | "default";

/** Execution uses project settings only so ~/.claude user defaults (e.g. gpt-5.4) do not override Eco proxy aliases on subagent LLM calls. */
export function resolveSdkSessionSkillConfig(
  scope: SdkSessionSkillsScope,
  input: {
    projectNames: readonly string[];
    profileMainSkills: readonly string[];
    explicitUser: readonly string[];
  },
): { settingSources: Array<"user" | "project">; skills: string[] } {
  if (scope === "planning") {
    const skills = mergeSkillNames(input.projectNames);
    return {
      settingSources: ["project"],
      skills,
    };
  }
  return {
    settingSources: ["project"],
    skills: mergeSkillNames(input.projectNames, input.profileMainSkills, input.explicitUser),
  };
}

export function mergeSkillNames(...lists: readonly (readonly string[])[]): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const list of lists) {
    for (const name of list) {
      const trimmed = name.trim();
      if (!trimmed || seen.has(trimmed)) {
        continue;
      }
      seen.add(trimmed);
      merged.push(trimmed);
    }
  }
  return merged.sort((a, b) => a.localeCompare(b));
}

const LEGACY_AGENT_SKILL_ROLES = [
  "planner",
  "explore",
  "architect",
  "coder",
  "reviewer",
  "tester",
] as const;

export function buildRuntimeAgentSkillAssignments(
  skills: readonly string[],
  profile?: Pick<OrchestrationProfile, "agents">,
): Partial<Record<string, string[]>> {
  if (skills.length === 0) {
    return {};
  }
  const cleanSkills = [...skills];
  const assignments: Partial<Record<string, string[]>> = Object.fromEntries(
    LEGACY_AGENT_SKILL_ROLES.map((role) => [role, [...cleanSkills]]),
  );
  for (const agent of profile?.agents ?? []) {
    if (!agent.enabled) {
      continue;
    }
    assignments[agent.agentKey] = [...cleanSkills];
    assignments[sdkAgentKeyForSkillAssignment(agent.agentKey)] = [...cleanSkills];
  }
  return assignments;
}

function sdkAgentKeyForSkillAssignment(agentKey: string): string {
  const sanitized = agentKey
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return sanitized.startsWith("eco_") ? sanitized : `eco_${sanitized || "agent"}`;
}

export function parseSkillFrontmatter(content: string): { name: string; description: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) {
    return { name: "", description: "" };
  }

  const block = match[1] ?? "";
  const name = readYamlScalar(block, "name");
  const description = readYamlScalar(block, "description");
  return { name, description };
}

function readYamlScalar(block: string, key: string): string {
  const pattern = new RegExp(`^${key}:\\s*(.+)$`, "m");
  const match = block.match(pattern);
  if (!match?.[1]) {
    return "";
  }
  let value = match[1].trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  return value;
}
