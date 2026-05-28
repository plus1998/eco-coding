import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseSkillFrontmatter, type SkillInfo, type SkillSource, type SkillsListResult } from "../shared/skills";

export async function listDiscoveredSkills(workspacePath?: string): Promise<SkillsListResult> {
  const userSkills = await scanSkillsDirectory(path.join(os.homedir(), ".claude", "skills"), "user");
  const projectSkills = workspacePath
    ? await scanProjectSkills(workspacePath)
    : [];

  return {
    workspacePath,
    userSkills,
    projectSkills,
    scannedAt: new Date().toISOString(),
  };
}

async function scanProjectSkills(workspacePath: string): Promise<SkillInfo[]> {
  const resolved = path.resolve(workspacePath);
  const repoRoot = (await findGitRoot(resolved)) ?? resolved;
  const discovered = new Map<string, SkillInfo>();

  let current = resolved;
  while (isPathInside(current, repoRoot)) {
    const skills = await scanSkillsDirectory(path.join(current, ".claude", "skills"), "project");
    for (const skill of skills) {
      const key = skill.directory;
      if (!discovered.has(key)) {
        discovered.set(key, skill);
      }
    }
    if (current === repoRoot) {
      break;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }

  return [...discovered.values()].sort((a, b) => a.name.localeCompare(b.name));
}

async function scanSkillsDirectory(
  skillsRoot: string,
  source: SkillSource,
): Promise<SkillInfo[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(skillsRoot);
  } catch {
    return [];
  }

  const skills: SkillInfo[] = [];
  for (const entry of entries) {
    if (entry.startsWith(".")) {
      continue;
    }
    const directory = path.join(skillsRoot, entry);
    const skillFilePath = path.join(directory, "SKILL.md");
    try {
      const stat = await fs.stat(skillFilePath);
      if (!stat.isFile()) {
        continue;
      }
    } catch {
      continue;
    }

    const content = await fs.readFile(skillFilePath, "utf8");
    const frontmatter = parseSkillFrontmatter(content);
    const fallbackName = entry;
    skills.push({
      name: frontmatter.name.trim() || fallbackName,
      description: frontmatter.description.trim() || "（无描述）",
      source,
      directory,
      skillFilePath,
    });
  }

  return skills.sort((a, b) => a.name.localeCompare(b.name));
}

async function findGitRoot(startPath: string): Promise<string | undefined> {
  let current = startPath;
  while (true) {
    try {
      await fs.access(path.join(current, ".git"));
      return current;
    } catch {
      const parent = path.dirname(current);
      if (parent === current) {
        return undefined;
      }
      current = parent;
    }
  }
}

function isPathInside(child: string, parent: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
