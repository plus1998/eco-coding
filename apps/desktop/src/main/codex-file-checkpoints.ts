import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

interface CheckpointManifest {
  mode: "git" | "filesystem";
  files: string[];
  presentFiles: string[];
}

const MAX_FILESYSTEM_CHECKPOINT_FILES = 20_000;
const MAX_FILESYSTEM_CHECKPOINT_BYTES = 512 * 1024 * 1024;

export class CodexFileCheckpointStore {
  constructor(private readonly rootDir: string) {}

  getRootDir(): string {
    return this.rootDir;
  }

  /** Remove all on-disk file checkpoints for a thread. */
  async deleteThread(threadId: string): Promise<void> {
    await fs.rm(path.join(this.rootDir, safeSegment(threadId)), { recursive: true, force: true });
  }

  async deleteAll(): Promise<void> {
    await fs.rm(this.rootDir, { recursive: true, force: true });
    await fs.mkdir(this.rootDir, { recursive: true });
  }

  /**
   * Directory names under the checkpoint root (already safeSegment form).
   * Empty array when the root does not exist.
   */
  async listThreadDirectoryNames(): Promise<string[]> {
    try {
      const entries = await fs.readdir(this.rootDir, { withFileTypes: true });
      return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw error;
    }
  }

  async deleteOrphans(activeThreadIds: Iterable<string>): Promise<string[]> {
    const keep = new Set(Array.from(activeThreadIds, (id) => safeSegment(id)));
    const names = await this.listThreadDirectoryNames();
    const removed: string[] = [];
    for (const name of names) {
      if (keep.has(name)) {
        continue;
      }
      await fs.rm(path.join(this.rootDir, name), { recursive: true, force: true });
      removed.push(name);
    }
    return removed;
  }

  async capturePending(threadId: string, worktreePath: string): Promise<void> {
    const directory = this.pendingDirectory(threadId);
    await fs.rm(directory, { recursive: true, force: true });
    await fs.mkdir(path.join(directory, "files"), { recursive: true });
    const inventory = await listCheckpointFiles(worktreePath);
    const files = inventory.files;
    const presentFiles: string[] = [];
    for (const relativePath of files) {
      const source = path.join(worktreePath, relativePath);
      try {
        await fs.lstat(source);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw error;
      }
      await fs.mkdir(path.dirname(path.join(directory, "files", relativePath)), { recursive: true });
      await fs.cp(source, path.join(directory, "files", relativePath), {
        recursive: true,
        preserveTimestamps: true,
        verbatimSymlinks: true,
      });
      presentFiles.push(relativePath);
    }
    const manifest: CheckpointManifest = { mode: inventory.mode, files, presentFiles };
    await fs.writeFile(path.join(directory, "manifest.json"), JSON.stringify(manifest), { mode: 0o600 });
  }

  async bindPending(threadId: string, itemId: string): Promise<void> {
    const source = this.pendingDirectory(threadId);
    const destination = this.itemDirectory(threadId, itemId);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.rm(destination, { recursive: true, force: true });
    await fs.rename(source, destination);
  }

  async restore(threadId: string, itemId: string, worktreePath: string): Promise<void> {
    const directory = this.itemDirectory(threadId, itemId);
    const manifest = JSON.parse(await fs.readFile(path.join(directory, "manifest.json"), "utf8")) as CheckpointManifest;
    const currentFiles = (await listCheckpointFiles(worktreePath, manifest.mode)).files;
    for (const relativePath of currentFiles) {
      await fs.rm(path.join(worktreePath, relativePath), { recursive: true, force: true });
    }
    const present = new Set(manifest.presentFiles);
    for (const relativePath of manifest.files) {
      if (!present.has(relativePath)) continue;
      const destination = path.join(worktreePath, relativePath);
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.cp(path.join(directory, "files", relativePath), destination, {
        recursive: true,
        preserveTimestamps: true,
        verbatimSymlinks: true,
      });
    }
  }

  private pendingDirectory(threadId: string): string {
    return path.join(this.rootDir, safeSegment(threadId), "pending");
  }

  private itemDirectory(threadId: string, itemId: string): string {
    return path.join(this.rootDir, safeSegment(threadId), "items", safeSegment(itemId));
  }
}

async function listGitFiles(worktreePath: string): Promise<string[]> {
  const { stdout } = await execFileAsync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
    cwd: worktreePath,
    encoding: "buffer",
    maxBuffer: 64 * 1024 * 1024,
  });
  return stdout
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .map((entry) => path.normalize(entry))
    .filter((entry) => entry !== ".." && !entry.startsWith(`..${path.sep}`) && !path.isAbsolute(entry));
}

async function listCheckpointFiles(
  worktreePath: string,
  requiredMode?: CheckpointManifest["mode"],
): Promise<{ mode: CheckpointManifest["mode"]; files: string[] }> {
  if (requiredMode !== "filesystem") {
    try {
      return { mode: "git", files: await listGitFiles(worktreePath) };
    } catch (error) {
      if (requiredMode === "git") throw error;
    }
  }
  return { mode: "filesystem", files: await listFilesystemFiles(worktreePath) };
}

async function listFilesystemFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  let totalBytes = 0;
  const visit = async (relativeDirectory: string): Promise<void> => {
    const directory = path.join(root, relativeDirectory);
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (!relativeDirectory && entry.name === ".git") continue;
      const relativePath = path.join(relativeDirectory, entry.name);
      if (entry.isDirectory()) {
        await visit(relativePath);
        continue;
      }
      const stat = await fs.lstat(path.join(root, relativePath));
      totalBytes += stat.size;
      files.push(relativePath);
      if (files.length > MAX_FILESYSTEM_CHECKPOINT_FILES || totalBytes > MAX_FILESYSTEM_CHECKPOINT_BYTES) {
        throw new Error(
          `Non-Git Codex workspace exceeds checkpoint limit (${MAX_FILESYSTEM_CHECKPOINT_FILES} files / 512 MB).`,
        );
      }
    }
  };
  await visit("");
  return files.sort((a, b) => a.localeCompare(b));
}

function safeSegment(value: string): string {
  const normalized = value.trim().replace(/[^a-zA-Z0-9._-]+/g, "_");
  if (!normalized) throw new Error("Codex file checkpoint requires a non-empty identifier.");
  return normalized;
}
