import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { WorkspaceInfo } from "../shared/ipc";

const execFileAsync = promisify(execFile);

let cachedGitExecutable: string | undefined;

export function resolveGitExecutable(): string {
  if (cachedGitExecutable) {
    return cachedGitExecutable;
  }

  const fromEnv = process.env.ECO_GIT_PATH?.trim();
  if (fromEnv && (fromEnv === "git" || existsSync(fromEnv))) {
    cachedGitExecutable = fromEnv;
    return fromEnv;
  }

  for (const candidate of ["/opt/homebrew/bin/git", "/usr/local/bin/git", "/usr/bin/git"]) {
    if (existsSync(candidate)) {
      cachedGitExecutable = candidate;
      return candidate;
    }
  }

  cachedGitExecutable = "git";
  return "git";
}

export async function findGitRootOnDisk(startPath: string): Promise<string | undefined> {
  let current = path.resolve(startPath);
  while (true) {
    if (await pathIsGitWorkTree(current)) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return undefined;
    }
    current = parent;
  }
}

async function pathIsGitWorkTree(dir: string): Promise<boolean> {
  try {
    const stat = await fs.stat(path.join(dir, ".git"));
    return stat.isDirectory() || stat.isFile();
  } catch {
    return false;
  }
}

async function readBranchFromHead(gitRoot: string): Promise<string | undefined> {
  try {
    const head = (await fs.readFile(path.join(gitRoot, ".git", "HEAD"), "utf8")).trim();
    const refMatch = /^ref: refs\/heads\/(.+)$/.exec(head);
    if (refMatch?.[1]) {
      return refMatch[1].trim();
    }
    if (/^[0-9a-f]{7,40}$/i.test(head)) {
      return `detached@${head.slice(0, 7)}`;
    }
    return head || undefined;
  } catch {
    return undefined;
  }
}

async function runGit(
  cwd: string,
  args: string[],
): Promise<{ ok: true; stdout: string } | { ok: false }> {
  try {
    const { stdout } = await execFileAsync(resolveGitExecutable(), args, { cwd });
    return { ok: true, stdout: stdout.trim() };
  } catch {
    return { ok: false };
  }
}

export async function inspectWorkspace(workspacePath: string): Promise<WorkspaceInfo> {
  const resolvedPath = path.resolve(workspacePath);
  const gitRevParse = await runGit(resolvedPath, ["rev-parse", "--show-toplevel"]);
  const gitRootPath = gitRevParse.ok ? gitRevParse.stdout : await findGitRootOnDisk(resolvedPath);
  const isGitRepository = Boolean(gitRootPath);

  let branch: string | undefined;
  let dirtyFileCount = 0;

  if (isGitRepository && gitRootPath) {
    const branchResult = await runGit(resolvedPath, ["branch", "--show-current"]);
    if (branchResult.ok) {
      branch = branchResult.stdout || "detached";
    } else {
      branch = await readBranchFromHead(gitRootPath);
    }

    const status = await runGit(resolvedPath, ["status", "--short"]);
    if (status.ok) {
      dirtyFileCount = status.stdout.split("\n").filter(Boolean).length;
    }
  }

  const workspace: WorkspaceInfo = {
    path: resolvedPath,
    name: path.basename(resolvedPath),
    isGitRepository,
    dirtyFileCount,
  };

  if (gitRootPath) {
    workspace.gitRoot = gitRootPath;
  }
  if (branch) {
    workspace.branch = branch;
  }

  const packageManager = await detectPackageManager(resolvedPath);
  if (packageManager) {
    workspace.packageManager = packageManager;
  }

  return workspace;
}

async function detectPackageManager(workspacePath: string): Promise<WorkspaceInfo["packageManager"]> {
  const candidates: Array<[WorkspaceInfo["packageManager"], string]> = [
    ["bun", "bun.lock"],
    ["pnpm", "pnpm-lock.yaml"],
    ["yarn", "yarn.lock"],
    ["npm", "package-lock.json"],
  ];

  for (const [manager, fileName] of candidates) {
    try {
      await fs.access(path.join(workspacePath, fileName));
      return manager;
    } catch {
      // try next lockfile
    }
  }
  return undefined;
}
