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
