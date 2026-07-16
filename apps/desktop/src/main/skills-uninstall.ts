import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import type { SkillInfo, SkillUninstallResult } from "../shared/skills";
import { resolveCommandExecutable, toSpawnEnv } from "./resolve-command-executable";

type SkillsCliRunner = (args: string[], cwd: string) => Promise<void>;

class SkillsCliUnavailableError extends Error {}

export async function uninstallDiscoveredSkill(
  skill: SkillInfo,
  options: { runSkillsCli?: SkillsCliRunner } = {},
): Promise<SkillUninstallResult> {
  if (skill.source !== "user") {
    throw new Error("Only user-level Skills can be uninstalled from Settings.");
  }
  if (isCodexSystemSkill(skill)) {
    throw new Error("Codex system Skills cannot be uninstalled.");
  }

  const stat = await fs.lstat(skill.directory);
  if (!stat.isSymbolicLink() && !stat.isDirectory()) {
    throw new Error("Skill path is not a directory or symbolic link.");
  }
  const removed = stat.isSymbolicLink() ? "link" : "directory";
  const cliAgent = skill.layout === "claude" ? "claude-code" : skill.layout === "codex" ? "codex" : undefined;
  if (cliAgent) {
    try {
      await (options.runSkillsCli ?? runSkillsCli)(
        ["remove", path.basename(skill.directory), "--global", "--agent", cliAgent, "--yes"],
        skill.baseDir ?? path.dirname(path.dirname(path.dirname(skill.directory))),
      );
      if (await pathExists(skill.directory)) {
        throw new Error("skills CLI completed but did not remove the selected Skill directory.");
      }
      return { ok: true, directory: skill.directory, removed, method: "skills-cli" };
    } catch (error) {
      if (!(error instanceof SkillsCliUnavailableError)) throw error;
    }
  }

  if (stat.isSymbolicLink()) {
    await fs.unlink(skill.directory);
    return { ok: true, directory: skill.directory, removed: "link", method: "filesystem" };
  }
  await fs.rm(skill.directory, { recursive: true });
  return { ok: true, directory: skill.directory, removed: "directory", method: "filesystem" };
}

async function runSkillsCli(args: string[], cwd: string): Promise<void> {
  let npx: string;
  try {
    npx = resolveCommandExecutable("npx");
  } catch (error) {
    throw new SkillsCliUnavailableError(error instanceof Error ? error.message : String(error));
  }
  await new Promise<void>((resolve, reject) => {
    execFile(
      npx,
      ["--yes", "skills", ...args],
      { cwd, env: toSpawnEnv(), timeout: 60_000, maxBuffer: 1024 * 1024 },
      (error, _stdout, stderr) => {
        if (!error) {
          resolve();
          return;
        }
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          reject(new SkillsCliUnavailableError("npx is unavailable."));
          return;
        }
        reject(new Error(stderr.trim() || error.message));
      },
    );
  });
}

async function pathExists(candidate: string): Promise<boolean> {
  try {
    await fs.lstat(candidate);
    return true;
  } catch {
    return false;
  }
}

export function isCodexSystemSkill(skill: Pick<SkillInfo, "baseDir" | "directory" | "layout">): boolean {
  if (skill.layout !== "codex" || !skill.baseDir) {
    return false;
  }
  const systemRoot = path.join(skill.baseDir, ".codex", "skills", ".system");
  const relative = path.relative(systemRoot, path.resolve(skill.directory));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
