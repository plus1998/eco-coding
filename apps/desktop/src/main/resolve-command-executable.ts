import fs from "node:fs";
import path from "node:path";
import type { PackageManagerKind } from "../shared/ipc";

const executableCache = new Map<string, string>();

const PACKAGE_MANAGER_ENV_KEYS: Record<PackageManagerKind, string> = {
  bun: "ECO_BUN_PATH",
  pnpm: "ECO_PNPM_PATH",
  yarn: "ECO_YARN_PATH",
  npm: "ECO_NPM_PATH",
};

const FALLBACK_PATH_PREFIXES = (home: string): string[] =>
  [
    "/opt/homebrew/bin",
    "/usr/local/bin",
    home ? path.join(home, ".bun", "bin") : "",
    home ? path.join(home, ".local", "bin") : "",
    home ? path.join(home, "Library", "pnpm") : "",
    ...resolveNvmNodeBinDirs(home),
  ].filter(Boolean);

function resolveNvmNodeBinDirs(home: string): string[] {
  const nvmDir = process.env.NVM_DIR?.trim() || (home ? path.join(home, ".nvm") : "");
  if (!nvmDir) {
    return [];
  }
  const dirs: string[] = [];
  const currentBin = path.join(nvmDir, "current", "bin");
  if (fs.existsSync(currentBin)) {
    dirs.push(currentBin);
  }
  const defaultAliasPath = path.join(nvmDir, "alias", "default");
  try {
    const version = fs.readFileSync(defaultAliasPath, "utf8").trim();
    if (version) {
      const versionBin = path.join(nvmDir, "versions", "node", version, "bin");
      if (fs.existsSync(versionBin)) {
        dirs.push(versionBin);
      }
    }
  } catch {
    // Ignore missing nvm alias files.
  }
  return dirs;
}

export function shellQuoteArg(value: string): string {
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(value)) {
    return value;
  }
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function buildShellCommandLine(command: string[]): string {
  return command.map(shellQuoteArg).join(" ");
}

export function pathDirectories(env: NodeJS.ProcessEnv = process.env): string[] {
  const pathKey = process.platform === "win32" ? "Path" : "PATH";
  const home = env.HOME ?? env.USERPROFILE ?? "";
  const fromEnv = (env[pathKey] ?? "").split(path.delimiter).filter(Boolean);
  return [...new Set([...FALLBACK_PATH_PREFIXES(home), ...fromEnv])];
}

export function toSpawnEnv(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const pathKey = process.platform === "win32" ? "Path" : "PATH";
  const spawnEnv: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === "string") {
      spawnEnv[key] = value;
    }
  }
  spawnEnv[pathKey] = pathDirectories(env).join(path.delimiter);
  spawnEnv.TERM = spawnEnv.TERM ?? "xterm-256color";
  return spawnEnv;
}

function resolveViaPath(name: string, directories: string[]): string | undefined {
  for (const directory of directories) {
    const candidate = path.join(directory, name);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

export function resolveCommandExecutable(name: string, envKey?: string): string {
  const cached = executableCache.get(name);
  if (cached) {
    return cached;
  }

  if (envKey) {
    const fromEnv = process.env[envKey]?.trim();
    if (fromEnv && fs.existsSync(fromEnv)) {
      executableCache.set(name, fromEnv);
      return fromEnv;
    }
  }

  if (name.includes(path.sep) && fs.existsSync(name)) {
    executableCache.set(name, name);
    return name;
  }

  const directories = pathDirectories();
  const fromPath = resolveViaPath(name, directories);
  if (fromPath) {
    executableCache.set(name, fromPath);
    return fromPath;
  }

  executableCache.set(name, name);
  return name;
}

export function resolvePackageManagerExecutable(packageManager: PackageManagerKind): string {
  return resolveCommandExecutable(packageManager, PACKAGE_MANAGER_ENV_KEYS[packageManager]);
}
