import fs from "node:fs/promises";
import path from "node:path";

/** Eco-owned PI agent tree under userData (never ~/.pi). */
export const PI_AGENT_ROOT_NAME = "pi-agent" as const;

/** Relative sessions root under a per-thread agentDir. */
export const PI_SESSIONS_REL = "sessions" as const;

/** Absolute path to `ecoDataDir/pi-agent`. */
export function resolvePiAgentRoot(ecoDataDir: string): string {
  return path.join(path.resolve(ecoDataDir), PI_AGENT_ROOT_NAME);
}

/** Absolute path to `ecoDataDir/pi-agent/<threadId>`. */
export function resolvePiAgentDir(ecoDataDir: string, threadId: string): string {
  const id = threadId.trim();
  if (!id) {
    throw new Error("PI agentDir requires a non-empty threadId.");
  }
  if (id.includes("/") || id.includes("\\") || id.includes("..")) {
    throw new Error(`Invalid PI threadId for agentDir: ${threadId}`);
  }
  return path.join(resolvePiAgentRoot(ecoDataDir), id);
}

/** Absolute path to `ecoDataDir/pi-agent/<threadId>/subagents/<agentId>`. */
export function resolvePiSubagentAgentDir(
  ecoDataDir: string,
  threadId: string,
  agentId: string,
): string {
  const id = agentId.trim();
  if (!id) {
    throw new Error("PI subagent agentDir requires a non-empty agentId.");
  }
  if (id.includes("/") || id.includes("\\") || id.includes("..")) {
    throw new Error(`Invalid PI subagent agentId for agentDir: ${agentId}`);
  }
  return path.join(resolvePiAgentDir(ecoDataDir, threadId), "subagents", id);
}

/** Absolute path to `<agentDir>/sessions`. */
export function resolvePiSessionsDir(agentDir: string): string {
  return path.join(path.resolve(agentDir), PI_SESSIONS_REL);
}

/** Ensure `<agentDir>/sessions` exists. */
export async function ensurePiSessionsDir(agentDir: string): Promise<string> {
  const dir = resolvePiSessionsDir(agentDir);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

/**
 * Delete all `*.jsonl` session files under `<agentDir>/sessions`.
 * Leaves the directory (and sibling skills/auth) intact.
 */
export async function clearPiSessionFiles(agentDir: string): Promise<number> {
  const dir = resolvePiSessionsDir(agentDir);
  let deleted = 0;
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return 0;
    }
    throw error;
  }
  for (const name of names) {
    if (!name.endsWith(".jsonl")) {
      continue;
    }
    const fullPath = path.join(dir, name);
    try {
      const stat = await fs.lstat(fullPath);
      if (!stat.isFile()) {
        continue;
      }
      await fs.unlink(fullPath);
      deleted += 1;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        continue;
      }
      throw error;
    }
  }
  return deleted;
}

/**
 * Find a persisted session file for `sessionId` under sessionsDir
 * (`{timestamp}_{sessionId}.jsonl`).
 */
export async function findPiSessionFile(
  sessionsDir: string,
  sessionId: string,
): Promise<string | undefined> {
  const id = sessionId.trim();
  if (!id) {
    return undefined;
  }
  const suffix = `_${id}.jsonl`;
  let names: string[];
  try {
    names = await fs.readdir(sessionsDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
  const matches = names
    .filter((name) => name.endsWith(suffix))
    .map((name) => path.join(sessionsDir, name))
    .sort((a, b) => a.localeCompare(b));
  return matches.length > 0 ? matches[matches.length - 1] : undefined;
}

/** Remove the entire `pi-agent/<threadId>` tree (sessions, skills, auth, …). */
export async function removePiAgentThreadDir(
  ecoDataDir: string,
  threadId: string,
): Promise<boolean> {
  const target = resolvePiAgentDir(ecoDataDir, threadId);
  try {
    await fs.lstat(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
  await fs.rm(target, { recursive: true, force: true });
  return true;
}

/** True when `sessionFile` exists, is a regular file, and lives under `sessionsDir`. */
export async function isUsablePiSessionFile(
  sessionFile: string,
  sessionsDir: string,
): Promise<boolean> {
  const resolvedFile = path.resolve(sessionFile);
  const resolvedDir = path.resolve(sessionsDir);
  const relative = path.relative(resolvedDir, resolvedFile);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    return false;
  }
  if (!resolvedFile.endsWith(".jsonl")) {
    return false;
  }
  try {
    const stat = await fs.lstat(resolvedFile);
    return stat.isFile();
  } catch {
    return false;
  }
}
