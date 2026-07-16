import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  CLAUDE_SKILLS_REL,
  CODEX_SKILLS_REL,
  dedupeSkillsByName,
  PROJECT_SKILL_ROOTS,
  parseSkillFrontmatter,
  type SkillInfo,
  type SkillLayout,
  type SkillSource,
  type SkillsListResult,
  USER_SKILL_ROOTS,
} from "../shared/skills";

export async function listDiscoveredSkills(
  workspacePath?: string,
  options: { homedir?: string } = {},
): Promise<SkillsListResult> {
  const homedir = options.homedir ?? os.homedir();
  const userSkills: SkillInfo[] = [];
  for (const rel of USER_SKILL_ROOTS) {
    const layout = skillLayoutForRoot(rel);
    const skillsRoot = path.join(homedir, rel);
    userSkills.push(...(await scanSkillsDirectory(skillsRoot, "user", layout, homedir)));
    if (layout === "codex") {
      userSkills.push(
        ...(await scanSkillsDirectory(path.join(skillsRoot, ".system"), "user", layout, homedir)),
      );
    }
  }
  await applySdkReadyFlags(userSkills, homedir);
  for (const skill of userSkills) {
    skill.settingsKey = `user:${skill.layout}:${skill.skillFilePath}`;
  }

  const projectSkills = workspacePath ? await scanProjectSkills(workspacePath) : [];
  if (workspacePath) {
    for (const skill of projectSkills) {
      skill.settingsKey = `project:${skill.layout}:${path.relative(path.resolve(workspacePath), skill.skillFilePath)}`;
    }
  }
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
      const layout = skillLayoutForRoot(rel);
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
    if (skill.layout === "codex") {
      skill.sdkReady = false;
      continue;
    }
    skill.sdkReady = await isAgentsSkillLinked(baseDir, skill.name, skill.directory);
  }
}

function skillLayoutForRoot(
  root: (typeof USER_SKILL_ROOTS)[number] | (typeof PROJECT_SKILL_ROOTS)[number],
): SkillLayout {
  if (root === CLAUDE_SKILLS_REL) {
    return "claude";
  }
  if (root === CODEX_SKILLS_REL) {
    return "codex";
  }
  return "agents";
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

  const catalogLock = await readCatalogSkillLock(baseDir, layout);
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
    const catalogIdentity = catalogLock.get(entry) ?? (await readLinkedCatalogIdentity(directory, entry));
    skills.push({
      name: frontmatter.name.trim() || fallbackName,
      description: frontmatter.description.trim() || "（无描述）",
      source,
      directory,
      skillFilePath,
      layout,
      sdkReady: layout === "claude",
      baseDir,
      ...(catalogIdentity && {
        catalogSource: catalogIdentity.source,
        catalogSkillId: catalogIdentity.skillId,
      }),
    });
  }

  return skills.sort((a, b) => a.name.localeCompare(b.name));
}

interface CatalogSkillIdentity {
  source: string;
  skillId: string;
}

async function readCatalogSkillLock(
  baseDir: string,
  layout: SkillLayout,
): Promise<Map<string, CatalogSkillIdentity>> {
  const layoutDirectory = layout === "agents" ? ".agents" : layout === "codex" ? ".codex" : ".claude";
  return readCatalogSkillLockFile(path.join(baseDir, layoutDirectory, ".skill-lock.json"));
}

async function readLinkedCatalogIdentity(
  directory: string,
  fallbackSkillId: string,
): Promise<CatalogSkillIdentity | undefined> {
  let resolved: string;
  try {
    resolved = await fs.realpath(directory);
  } catch {
    return undefined;
  }
  if (resolved === directory || path.basename(path.dirname(resolved)) !== "skills") return undefined;
  const lock = await readCatalogSkillLockFile(
    path.join(path.dirname(path.dirname(resolved)), ".skill-lock.json"),
  );
  return lock.get(path.basename(resolved)) ?? lock.get(fallbackSkillId);
}

async function readCatalogSkillLockFile(lockPath: string): Promise<Map<string, CatalogSkillIdentity>> {
  const identities = new Map<string, CatalogSkillIdentity>();
  let payload: unknown;
  try {
    payload = JSON.parse(await fs.readFile(lockPath, "utf8")) as unknown;
  } catch {
    return identities;
  }
  if (!isRecord(payload) || !isRecord(payload.skills)) return identities;
  for (const [installedName, value] of Object.entries(payload.skills)) {
    if (!isRecord(value) || typeof value.source !== "string" || !value.source.trim()) continue;
    const skillId =
      typeof value.skillId === "string" && value.skillId.trim() ? value.skillId.trim() : installedName;
    identities.set(installedName, { source: value.source.trim(), skillId });
  }
  return identities;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
