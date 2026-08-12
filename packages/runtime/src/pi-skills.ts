import fs from "node:fs/promises";
import path from "node:path";

/** Relative skills root under a PI per-thread agentDir. */
export const PI_PRIVATE_SKILLS_REL = "skills" as const;

/** Absolute path to the session-private skills directory for a PI agentDir. */
export function resolvePiPrivateSkillsDir(agentDir: string): string {
  return path.join(path.resolve(agentDir), PI_PRIVATE_SKILLS_REL);
}

/** Ensure `<agentDir>/skills` exists for session-private skill mounts. */
export async function ensurePiPrivateSkillsDir(agentDir: string): Promise<string> {
  const dir = resolvePiPrivateSkillsDir(agentDir);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

/**
 * Symlink (or copy-fallback) a skill directory into the thread-private skills root.
 * Used for session-only mounts that should not rely on shared workspace discovery.
 */
export async function mountSkillIntoPiPrivateDir(input: {
  agentDir: string;
  skillDirectory: string;
  skillName: string;
}): Promise<string> {
  const privateRoot = await ensurePiPrivateSkillsDir(input.agentDir);
  const safeName = input.skillName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!safeName) {
    throw new Error("PI private skill mount requires a non-empty skill name.");
  }
  const target = path.join(privateRoot, safeName);
  const source = path.resolve(input.skillDirectory);
  try {
    await fs.lstat(target);
    await fs.rm(target, { recursive: true, force: true });
  } catch {
    // missing is fine
  }
  try {
    await fs.symlink(source, target, "dir");
  } catch {
    await fs.cp(source, target, { recursive: true });
  }
  return target;
}

/** Stable fingerprint for PI skill path visibility (order-independent). */
export function fingerprintPiSkillPaths(paths: readonly string[] | undefined): string {
  if (!paths || paths.length === 0) {
    return "";
  }
  const normalized = [
    ...new Set(
      paths
        .map((entry) => entry.trim())
        .filter(Boolean)
        .map((entry) => path.resolve(entry)),
    ),
  ].sort((a, b) => a.localeCompare(b));
  return JSON.stringify(normalized);
}

/** Merge Eco-selected skill paths with the per-thread private skills root. */
export function resolvePiSessionSkillPaths(input: {
  agentDir: string;
  skillPaths?: readonly string[];
}): string[] {
  const privateDir = resolvePiPrivateSkillsDir(input.agentDir);
  const merged = [
    ...(input.skillPaths ?? []).map((entry) => entry.trim()).filter(Boolean),
    privateDir,
  ].map((entry) => path.resolve(entry));
  return [...new Set(merged)].sort((a, b) => a.localeCompare(b));
}
