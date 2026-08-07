import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

export interface AgentBrowserResolveResult {
  available: boolean;
  binaryPath?: string;
  reason?: string;
}

function tryGetAppPath(): string | undefined {
  try {
    const require = createRequire(import.meta.url);
    const electron = require("electron") as { app?: { getAppPath?: () => string } };
    return electron.app?.getAppPath?.();
  } catch {
    return undefined;
  }
}

function platformBinaryName(platform: NodeJS.Platform, arch: string): string | undefined {
  if (platform === "darwin" && arch === "arm64") {
    return "agent-browser-darwin-arm64";
  }
  if (platform === "darwin" && (arch === "x64" || arch === "x86_64")) {
    return "agent-browser-darwin-x64";
  }
  if (platform === "linux" && arch === "arm64") {
    return "agent-browser-linux-arm64";
  }
  if (platform === "linux" && (arch === "x64" || arch === "x86_64")) {
    return "agent-browser-linux-x64";
  }
  if (platform === "win32" && (arch === "x64" || arch === "x86_64")) {
    return "agent-browser-win32-x64.exe";
  }
  return undefined;
}

/**
 * Bun (and some installers) leave native binaries without +x.
 * agent-browser itself chmods on the JS wrapper; Eco spawns the native binary directly.
 */
export function ensureNativeBinaryExecutable(
  filePath: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) {
      return false;
    }
  } catch {
    return false;
  }

  if (platform === "win32") {
    try {
      fs.accessSync(filePath, fs.constants.R_OK);
      return true;
    } catch {
      return false;
    }
  }

  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    try {
      fs.chmodSync(filePath, 0o755);
      fs.accessSync(filePath, fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  }
}

function packageBinDirCandidates(): string[] {
  const candidates: string[] = [];
  try {
    if (typeof process.resourcesPath === "string" && process.resourcesPath) {
      candidates.push(path.join(process.resourcesPath, "agent-browser"));
      candidates.push(
        path.join(process.resourcesPath, "app.asar.unpacked", "node_modules", "agent-browser", "bin"),
      );
    }
  } catch {
    // ignore
  }
  const appPath = tryGetAppPath();
  if (appPath) {
    candidates.push(path.join(appPath, "node_modules", "agent-browser", "bin"));
    candidates.push(path.join(appPath, "..", "node_modules", "agent-browser", "bin"));
    candidates.push(path.join(appPath, "packaging", "agent-browser"));
  }
  // Dev monorepo: apps/desktop or workspace root
  candidates.push(path.join(process.cwd(), "packaging", "agent-browser"));
  candidates.push(path.join(process.cwd(), "apps", "desktop", "packaging", "agent-browser"));
  candidates.push(path.join(process.cwd(), "node_modules", "agent-browser", "bin"));
  candidates.push(path.join(process.cwd(), "apps", "desktop", "node_modules", "agent-browser", "bin"));
  return candidates;
}

/**
 * CLI args for Eco's built-in browser MCP.
 * Global flags like `--cdp` must come *before* the `mcp` subcommand.
 */
export function buildAgentBrowserMcpArgs(cdpPort: number): string[] {
  return ["--cdp", String(cdpPort), "mcp", "--tools", "core"];
}

/**
 * Resolve the platform-native agent-browser binary.
 * Prefer extraResources (`process.resourcesPath/agent-browser/...`) then node_modules.
 */
export function resolveAgentBrowserBinary(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): AgentBrowserResolveResult {
  const binaryName = platformBinaryName(platform, arch);
  if (!binaryName) {
    return {
      available: false,
      reason: `agent-browser 未提供 ${platform}/${arch} 平台二进制。`,
    };
  }

  const tried: string[] = [];
  for (const dir of packageBinDirCandidates()) {
    const candidates = [
      path.join(dir, binaryName),
      path.join(dir, platform === "win32" ? "agent-browser.exe" : "agent-browser"),
    ];
    for (const candidate of candidates) {
      tried.push(candidate);
      if (ensureNativeBinaryExecutable(candidate, platform)) {
        return { available: true, binaryPath: candidate };
      }
    }
  }

  return {
    available: false,
    reason: `未找到可执行的 agent-browser 二进制（期望 ${binaryName}）。请安装依赖或运行 packaging prepare；候选路径：${tried.slice(0, 4).join(", ")}…`,
  };
}
