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

const WINDOWS_PATHEXT = [".COM", ".EXE", ".BAT", ".CMD"] as const;

const FALLBACK_PATH_PREFIXES = (home: string): string[] => {
  if (process.platform === "win32") {
    const appData = process.env.APPDATA?.trim() ?? (home ? path.join(home, "AppData", "Roaming") : "");
    return [
      "C:\\Program Files\\nodejs",
      appData ? path.join(appData, "npm") : "",
      ...resolveNvmWindowsBinDirs(home, appData),
    ].filter(Boolean);
  }
  return [
    "/opt/homebrew/bin",
    "/usr/local/bin",
    home ? path.join(home, ".bun", "bin") : "",
    home ? path.join(home, ".local", "bin") : "",
    home ? path.join(home, "Library", "pnpm") : "",
    ...resolveNvmNodeBinDirs(home),
  ].filter(Boolean);
};

function resolveNvmWindowsBinDirs(home: string, appData: string): string[] {
  const nvmHome = process.env.NVM_HOME?.trim();
  if (nvmHome) {
    return [nvmHome];
  }
  const nvmSymlink = process.env.NVM_SYMLINK?.trim();
  if (nvmSymlink) {
    return [nvmSymlink];
  }
  if (!appData) {
    return [];
  }
  const nvmRoot = path.join(appData, "nvm");
  if (!fs.existsSync(nvmRoot)) {
    return [];
  }
  try {
    const currentVersion = fs.readFileSync(path.join(nvmRoot, "alias", "default"), "utf8").trim();
    if (currentVersion) {
      return [path.join(nvmRoot, `v${currentVersion.replace(/^v/, "")}`)];
    }
  } catch {
    // Ignore missing nvm alias files.
  }
  return [];
}

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
  if (process.platform === "win32") {
    return buildWindowsCommandLine(command);
  }
  return command.map(shellQuoteArg).join(" ");
}

export function windowsCmdQuoteArg(value: string): string {
  if (!/[\s"&|<>^%]/.test(value)) {
    return value;
  }
  return `"${value.replace(/"/g, '""')}"`;
}

export function buildWindowsCommandLine(command: string[]): string {
  return command.map(windowsCmdQuoteArg).join(" ");
}

export function needsWindowsShellWrapper(executable: string): boolean {
  if (process.platform !== "win32") {
    return false;
  }
  const ext = path.extname(executable).toLowerCase();
  return ext !== ".exe";
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

function windowsPathExtensions(env: NodeJS.ProcessEnv = process.env): string[] {
  const configured = (env.PATHEXT ?? env.Pathext ?? "")
    .split(";")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => (entry.startsWith(".") ? entry : `.${entry}`).toUpperCase());
  return configured.length > 0 ? configured : [...WINDOWS_PATHEXT];
}

function resolveViaPath(name: string, directories: string[], env: NodeJS.ProcessEnv = process.env): string | undefined {
  const hasExtension = path.extname(name).length > 0;
  if (process.platform === "win32" && !hasExtension) {
    for (const directory of directories) {
      for (const extension of windowsPathExtensions(env)) {
        const candidate = path.join(directory, `${name}${extension}`);
        if (fs.existsSync(candidate)) {
          return candidate;
        }
      }
    }
    return undefined;
  }

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
