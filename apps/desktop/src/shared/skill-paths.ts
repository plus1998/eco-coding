import path from "node:path";
import { PROJECT_SKILL_ROOTS, type SkillInfo } from "./skills";

/** Node-only path resolution for SDK skill roots. */
export function resolveImplicitSkillReadRoots(
  _homedir: string,
  workspacePath?: string,
  skills: readonly Pick<SkillInfo, "directory">[] = [],
): string[] {
  const roots = new Set<string>();
  if (workspacePath?.trim()) {
    const resolvedWorkspace = path.resolve(workspacePath.trim());
    for (const rel of PROJECT_SKILL_ROOTS) {
      roots.add(path.join(resolvedWorkspace, rel));
    }
  }
  for (const skill of skills) {
    if (skill.directory.trim()) {
      roots.add(path.resolve(skill.directory.trim()));
    }
  }
  return [...roots];
}
