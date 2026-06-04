import fs from "node:fs/promises";
import path from "node:path";
import type { LinkAgentsSkillsResult, SkillInfo } from "../shared/skills";

/** Relative path from `base/.claude/skills/<name>` to `base/.agents/skills/<name>`. */
export function agentsToClaudeSymlinkTarget(skillName: string): string {
  return path.join("..", "..", ".agents", "skills", skillName);
}

export async function linkAgentsSkillsToClaude(
  agentsOnly: readonly SkillInfo[],
  options?: { baseDir?: string },
): Promise<LinkAgentsSkillsResult> {
  const result: LinkAgentsSkillsResult = {
    created: [],
    skipped: [],
    errors: [],
  };

  const filtered = agentsOnly.filter((skill) => {
    if (options?.baseDir && skill.baseDir !== options.baseDir) {
      return false;
    }
    return skill.layout === "agents" && !skill.sdkReady && skill.baseDir;
  });

  for (const skill of filtered) {
    const baseDir = skill.baseDir!;
    const claudeSkillsRoot = path.join(baseDir, ".claude", "skills");
    const claudeSkillDir = path.join(claudeSkillsRoot, skill.name);
    const agentsSkillDir = path.join(baseDir, ".agents", "skills", skill.name);

    try {
      await fs.mkdir(claudeSkillsRoot, { recursive: true });

      let existing: Awaited<ReturnType<typeof fs.lstat>> | undefined;
      try {
        existing = await fs.lstat(claudeSkillDir);
      } catch {
        existing = undefined;
      }

      if (existing) {
        if (existing.isSymbolicLink()) {
          const target = await fs.readlink(claudeSkillDir);
          const resolved = path.resolve(path.dirname(claudeSkillDir), target);
          if (resolved === agentsSkillDir) {
            result.skipped.push({
              name: skill.name,
              baseDir,
              reason: "链接已存在",
            });
            continue;
          }
        }
        result.skipped.push({
          name: skill.name,
          baseDir,
          reason: "`.claude/skills` 下已有同名目录",
        });
        continue;
      }

      const relativeTarget = agentsToClaudeSymlinkTarget(skill.name);
      await fs.symlink(relativeTarget, claudeSkillDir);
      result.created.push({
        name: skill.name,
        baseDir,
        linkPath: claudeSkillDir,
      });
    } catch (error) {
      result.errors.push(
        `${skill.name} (${baseDir}): ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return result;
}
