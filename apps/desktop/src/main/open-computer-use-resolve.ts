import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { ensureNativeBinaryExecutable } from "./agent-browser-resolve";

export interface OpenComputerUseResolveResult {
  available: boolean;
  /** Native open-computer-use binary (not the Node launcher). */
  binaryPath?: string;
  /** Package root containing bin/ + dist/ (when resolved from node_modules). */
  packageRoot?: string;
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

/**
 * Relative path segments inside @qwen-code/open-computer-use for the native runtime.
 * Mirrors the npm launcher's platformPackages table.
 */
export function openComputerUseNativeRelativePath(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): string[] | undefined {
  const key = `${platform}-${arch === "x86_64" ? "x64" : arch}`;
  switch (key) {
    case "darwin-arm64":
    case "darwin-x64":
      return ["dist", "Open Computer Use.app", "Contents", "MacOS", "OpenComputerUse"];
    case "linux-arm64":
      return ["dist", "linux", "arm64", "open-computer-use"];
    case "linux-x64":
      return ["dist", "linux", "amd64", "open-computer-use"];
    case "win32-arm64":
      return ["dist", "windows", "arm64", "open-computer-use.exe"];
    case "win32-x64":
      return ["dist", "windows", "amd64", "open-computer-use.exe"];
    default:
      return undefined;
  }
}

function packagedBinaryName(platform: NodeJS.Platform): string {
  return platform === "win32" ? "open-computer-use.exe" : "open-computer-use";
}

function packageRootCandidates(): string[] {
  const candidates: string[] = [];
  try {
    if (typeof process.resourcesPath === "string" && process.resourcesPath) {
      candidates.push(path.join(process.resourcesPath, "open-computer-use"));
      candidates.push(
        path.join(
          process.resourcesPath,
          "app.asar.unpacked",
          "node_modules",
          "@qwen-code",
          "open-computer-use",
        ),
      );
    }
  } catch {
    // ignore
  }
  const appPath = tryGetAppPath();
  if (appPath) {
    candidates.push(path.join(appPath, "node_modules", "@qwen-code", "open-computer-use"));
    candidates.push(path.join(appPath, "..", "node_modules", "@qwen-code", "open-computer-use"));
    candidates.push(path.join(appPath, "packaging", "open-computer-use"));
  }
  candidates.push(path.join(process.cwd(), "packaging", "open-computer-use"));
  candidates.push(path.join(process.cwd(), "apps", "desktop", "packaging", "open-computer-use"));
  candidates.push(path.join(process.cwd(), "node_modules", "@qwen-code", "open-computer-use"));
  candidates.push(
    path.join(process.cwd(), "apps", "desktop", "node_modules", "@qwen-code", "open-computer-use"),
  );
  return candidates;
}

/**
 * Resolve the platform-native open-computer-use binary.
 * Prefer extraResources (`process.resourcesPath/open-computer-use/...`) then node_modules.
 */
export function resolveOpenComputerUseBinary(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): OpenComputerUseResolveResult {
  const relative = openComputerUseNativeRelativePath(platform, arch);
  if (!relative) {
    return {
      available: false,
      reason: `open-computer-use 未提供 ${platform}/${arch} 平台二进制。`,
    };
  }

  const tried: string[] = [];
  for (const root of packageRootCandidates()) {
    const nested = path.join(root, ...relative);
    const flat = path.join(root, packagedBinaryName(platform));
    for (const candidate of [flat, nested]) {
      tried.push(candidate);
      if (ensureNativeBinaryExecutable(candidate, platform)) {
        return {
          available: true,
          binaryPath: candidate,
          packageRoot: root,
        };
      }
    }
  }

  // Also accept a packaging layout that copied only the binary (no package root).
  for (const root of packageRootCandidates()) {
    if (!fs.existsSync(root)) {
      continue;
    }
    try {
      const entries = fs.readdirSync(root);
      for (const entry of entries) {
        if (entry === packagedBinaryName(platform) || entry === "OpenComputerUse") {
          const candidate = path.join(root, entry);
          tried.push(candidate);
          if (ensureNativeBinaryExecutable(candidate, platform)) {
            return { available: true, binaryPath: candidate, packageRoot: root };
          }
        }
      }
    } catch {
      // ignore
    }
  }

  return {
    available: false,
    reason: `未找到可执行的 open-computer-use 二进制。请安装 @qwen-code/open-computer-use 或运行 packaging prepare；候选路径：${tried.slice(0, 4).join(", ")}…`,
  };
}
