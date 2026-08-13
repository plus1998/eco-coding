import fs from "node:fs/promises";
import path from "node:path";
import { resolveCodexHomeDir } from "@eco/runtime/codex-config-sync";
import type {
  StorageCategoryId,
  StorageCategoryUsage,
  StorageUsageSnapshot,
} from "../shared/storage-usage";
import {
  resolveClaudeFileHistoryDir,
  resolveClaudeProjectsDir,
} from "./claude-session-paths";
import { getUpstreamLogBaseDir } from "./upstream-log";

export interface StorageInventoryPaths {
  userDataDir: string;
  databasePath: string;
  codexCheckpointsDir: string;
  /** Override for tests; default from getUpstreamLogBaseDir(). */
  logsDir?: string;
  /** Override for tests; default resolveCodexHomeDir(userDataDir). */
  codexHomeDir?: string;
  /** Override for tests; `~/.claude/projects`. */
  claudeProjectsDir?: string;
  /** Override for tests; `~/.claude/file-history`. */
  claudeFileHistoryDir?: string;
  /** Override for tests; `userData/pi-agent`. */
  piAgentDir?: string;
}

export interface BuildStorageUsageOptions {
  paths: StorageInventoryPaths;
  threadCount?: number;
}

/** Recursive byte total; does not follow symlinks. */
export async function measurePathBytes(targetPath: string): Promise<{
  bytes: number;
  exists: boolean;
  fileCount: number;
}> {
  try {
    const root = await fs.lstat(targetPath);
    if (root.isSymbolicLink()) {
      return { bytes: 0, exists: true, fileCount: 0 };
    }
    if (!root.isDirectory()) {
      return { bytes: root.size, exists: true, fileCount: 1 };
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { bytes: 0, exists: false, fileCount: 0 };
    }
    throw error;
  }

  let bytes = 0;
  let fileCount = 0;
  const visit = async (directory: string): Promise<void> => {
    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return;
      }
      throw error;
    }
    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);
      let stat;
      try {
        stat = await fs.lstat(fullPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          continue;
        }
        throw error;
      }
      if (stat.isSymbolicLink()) {
        continue;
      }
      if (stat.isDirectory()) {
        await visit(fullPath);
        continue;
      }
      if (stat.isFile()) {
        bytes += stat.size;
        fileCount += 1;
      }
    }
  };
  await visit(targetPath);
  return { bytes, exists: true, fileCount };
}

export async function measureDatabaseBytes(databasePath: string): Promise<{
  bytes: number;
  exists: boolean;
  fileCount: number;
  path: string;
}> {
  const suffixes = ["", "-wal", "-shm"];
  let bytes = 0;
  let fileCount = 0;
  let anyExists = false;
  for (const suffix of suffixes) {
    const filePath = `${databasePath}${suffix}`;
    const measured = await measurePathBytes(filePath);
    if (measured.exists) {
      anyExists = true;
      bytes += measured.bytes;
      fileCount += measured.fileCount;
    }
  }
  return { bytes, exists: anyExists, fileCount, path: databasePath };
}

/** Claude session JSONL under projects/ plus file-history checkpoints. */
export async function measureClaudeSessionBytes(
  projectsDir: string,
  fileHistoryDir: string,
): Promise<{ bytes: number; exists: boolean; fileCount: number; path: string }> {
  const [projects, history] = await Promise.all([
    measurePathBytes(projectsDir),
    measurePathBytes(fileHistoryDir),
  ]);
  return {
    path: projectsDir,
    bytes: projects.bytes + history.bytes,
    exists: projects.exists || history.exists,
    fileCount: projects.fileCount + history.fileCount,
  };
}

/**
 * Sum userData files not already counted in exclusive categories.
 * Exclusive: database family, codex-file-checkpoints tree, codex/ home.
 */
export async function measureOtherUserDataBytes(
  userDataDir: string,
  exclusiveRelativeRoots: string[],
  databaseBasename: string,
): Promise<{ bytes: number; exists: boolean; fileCount: number }> {
  try {
    await fs.lstat(userDataDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { bytes: 0, exists: false, fileCount: 0 };
    }
    throw error;
  }

  const exclusiveNames = new Set(exclusiveRelativeRoots.map((name) => path.normalize(name)));
  exclusiveNames.add(databaseBasename);
  exclusiveNames.add(`${databaseBasename}-wal`);
  exclusiveNames.add(`${databaseBasename}-shm`);

  let bytes = 0;
  let fileCount = 0;
  let entries;
  try {
    entries = await fs.readdir(userDataDir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { bytes: 0, exists: false, fileCount: 0 };
    }
    throw error;
  }

  for (const entry of entries) {
    if (exclusiveNames.has(entry.name)) {
      continue;
    }
    const fullPath = path.join(userDataDir, entry.name);
    const measured = await measurePathBytes(fullPath);
    bytes += measured.bytes;
    fileCount += measured.fileCount;
  }
  return { bytes, exists: true, fileCount };
}

export async function buildStorageUsageSnapshot(
  options: BuildStorageUsageOptions,
): Promise<StorageUsageSnapshot> {
  const { paths } = options;
  const logsDir = paths.logsDir ?? getUpstreamLogBaseDir();
  const codexHomeDir = paths.codexHomeDir ?? resolveCodexHomeDir(paths.userDataDir);
  const claudeProjectsDir = paths.claudeProjectsDir ?? resolveClaudeProjectsDir();
  const claudeFileHistoryDir = paths.claudeFileHistoryDir ?? resolveClaudeFileHistoryDir();
  const piAgentDir = paths.piAgentDir ?? path.join(paths.userDataDir, "pi-agent");
  const databaseBasename = path.basename(paths.databasePath);

  const [database, logs, claudeSessions, codexCheckpoints, codexHome, piAgent, otherUserData] =
    await Promise.all([
      measureDatabaseBytes(paths.databasePath),
      measurePathBytes(logsDir),
      measureClaudeSessionBytes(claudeProjectsDir, claudeFileHistoryDir),
      measurePathBytes(paths.codexCheckpointsDir),
      measurePathBytes(codexHomeDir),
      measurePathBytes(piAgentDir),
      measureOtherUserDataBytes(
        paths.userDataDir,
        ["codex-file-checkpoints", "codex", "pi-agent"],
        databaseBasename,
      ),
    ]);

  const categories: StorageCategoryUsage[] = [
    {
      id: "database" satisfies StorageCategoryId,
      path: database.path,
      bytes: database.bytes,
      exists: database.exists,
      detail: {
        ...(options.threadCount !== undefined ? { threadCount: options.threadCount } : {}),
        fileCount: database.fileCount,
      },
    },
    {
      id: "logs",
      path: logsDir,
      bytes: logs.bytes,
      exists: logs.exists,
      detail: { fileCount: logs.fileCount },
    },
    {
      id: "claudeSessions",
      path: claudeProjectsDir,
      bytes: claudeSessions.bytes,
      exists: claudeSessions.exists,
      detail: { fileCount: claudeSessions.fileCount },
    },
    {
      id: "codexCheckpoints",
      path: paths.codexCheckpointsDir,
      bytes: codexCheckpoints.bytes,
      exists: codexCheckpoints.exists,
      detail: { fileCount: codexCheckpoints.fileCount },
    },
    {
      id: "codexHome",
      path: codexHomeDir,
      bytes: codexHome.bytes,
      exists: codexHome.exists,
      detail: { fileCount: codexHome.fileCount },
    },
    {
      id: "piAgent",
      path: piAgentDir,
      bytes: piAgent.bytes,
      exists: piAgent.exists,
      detail: { fileCount: piAgent.fileCount },
    },
    {
      id: "otherUserData",
      path: paths.userDataDir,
      bytes: otherUserData.bytes,
      exists: otherUserData.exists,
      detail: { fileCount: otherUserData.fileCount },
    },
  ];

  const totalBytes = categories.reduce((sum, category) => sum + category.bytes, 0);

  return {
    totalBytes,
    categories,
    unmetered: [],
  };
}
