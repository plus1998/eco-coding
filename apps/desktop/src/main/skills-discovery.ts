import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  AGENTS_SKILLS_REL,
  CLAUDE_SKILLS_REL,
  dedupeSkillsByName,
  parseSkillFrontmatter,
  PROJECT_SKILL_ROOTS,
  USER_SKILL_ROOTS,
  type SkillInfo,
  type SkillLayout,
  type SkillSource,
  type SkillsListResult,
} from "../shared/skills";

export async function listDiscoveredSkills(workspacePath?: string): Promise<SkillsListResult> {
  const homedir = os.homedir();
  const userSkills: SkillInfo[] = [];
  for (const rel of USER_SKILL_ROOTS) {
    const layout: SkillLayout = rel === CLAUDE_SKILLS_REL ? "claude" : "agents";
    const skills = await scanSkillsDirectory(path.join(homedir, rel), "user", layout, homedir);
    userSkills.push(...skills);
  }
  await applySdkReadyFlags(userSkills, homedir);

  const projectSkills = workspacePath ? await scanProjectSkills(workspacePath) : [];
  const projectSdkReadyNames = new Set(
    projectSkills.filter((skill) => skill.sdkReady).map((skill) => skill.name),
  );
  const agentsOnlySkills = dedupeSkillsByName(
    [...userSkills, ...projectSkills].filter(
      (skill) =>
        skill.layout === "agents" &&
        !skill.sdkReady &&
        (skill.source === "user" || !projectSdkReadyNames.has(skill.name)),
    ),
  );

  return {
    ...(workspacePath && { workspacePath }),
    userSkills,
    projectSkills,
    agentsOnlySkills,
    scannedAt: new Date().toISOString(),
  };
}

async function scanProjectSkills(workspacePath: string): Promise<SkillInfo[]> {
  const resolved = path.resolve(workspacePath);
  const repoRoot = (await findGitRoot(resolved)) ?? resolved;
  const discovered = new Map<string, SkillInfo>();

  let current = resolved;
  while (isPathInside(current, repoRoot)) {
    for (const rel of PROJECT_SKILL_ROOTS) {
      const layout: SkillLayout = rel === CLAUDE_SKILLS_REL ? "claude" : "agents";
      const skills = await scanSkillsDirectory(path.join(current, rel), "project", layout, current);
      for (const skill of skills) {
        if (!discovered.has(skill.directory)) {
          discovered.set(skill.directory, skill);
        }
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

  const all = [...discovered.values()];
  const byBase = new Map<string, SkillInfo[]>();
  for (const skill of all) {
    const base = skill.baseDir ?? resolved;
    const list = byBase.get(base) ?? [];
    list.push(skill);
    byBase.set(base, list);
  }
  for (const [baseDir, skills] of byBase) {
    await applySdkReadyFlags(skills, baseDir);
  }

  return all.sort((a, b) => a.name.localeCompare(b.name));
}

async function applySdkReadyFlags(skills: SkillInfo[], baseDir: string): Promise<void> {
  for (const skill of skills) {
    if (skill.layout === "claude") {
      skill.sdkReady = true;
      continue;
    }
    skill.sdkReady = await isAgentsSkillLinked(baseDir, skill.name, skill.directory);
  }
}

async function isAgentsSkillLinked(
  baseDir: string,
  skillName: string,
  agentsSkillDirectory: string,
): Promise<boolean> {
  const claudeSkillDir = path.join(baseDir, ".claude", "skills", skillName);
  const claudeSkillFile = path.join(claudeSkillDir, "SKILL.md");

  try {
    const stat = await fs.lstat(claudeSkillDir);
    if (stat.isSymbolicLink()) {
      const target = await fs.readlink(claudeSkillDir);
      const resolved = path.resolve(path.dirname(claudeSkillDir), target);
      return resolved === agentsSkillDirectory;
    }
    await fs.access(claudeSkillFile);
    return true;
  } catch {
    return false;
  }
}

async function scanSkillsDirectory(
  skillsRoot: string,
  source: SkillSource,
  layout: SkillLayout,
  baseDir: string,
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
      layout,
      sdkReady: layout === "claude",
      baseDir,
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
