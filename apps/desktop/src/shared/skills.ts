export type SkillSource = "user" | "project";

export interface SkillInfo {
  name: string;
  description: string;
  source: SkillSource;
  /** Directory containing SKILL.md */
  directory: string;
  skillFilePath: string;
}

export interface SkillsListResult {
  workspacePath?: string;
  userSkills: SkillInfo[];
  projectSkills: SkillInfo[];
  scannedAt: string;
}

const EXPLICIT_SKILL_NAME_PATTERN = /\$([a-zA-Z0-9][a-zA-Z0-9_-]*)/g;

/** Skill names from Codex-style `$skill-name` tokens in a prompt. */
export function parseExplicitSkillNames(prompt: string | undefined): string[] {
  if (!prompt?.trim()) {
    return [];
  }
  const names: string[] = [];
  const seen = new Set<string>();
  for (const match of prompt.matchAll(EXPLICIT_SKILL_NAME_PATTERN)) {
    const name = match[1];
    if (!name || seen.has(name)) {
      continue;
    }
    seen.add(name);
    names.push(name);
  }
  return names;
}

/** `$name` tokens that match discovered user-level skills. */
export function filterExplicitUserSkillNames(
  prompt: string | undefined,
  userSkills: readonly Pick<SkillInfo, "name">[],
): string[] {
  const allowed = new Set(userSkills.map((skill) => skill.name));
  return parseExplicitSkillNames(prompt).filter((name) => allowed.has(name));
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
