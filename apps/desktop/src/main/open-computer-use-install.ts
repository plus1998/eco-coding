/**
 * Install Open Computer Use.app outside the host Eco bundle for macOS TCC.
 *
 * Helpers nested under Eco Coding.app/Contents/Resources are attributed to the
 * outer app for Screen Recording — granting the nested bundle in System Settings
 * does not stick. Codex / similar apps install the helper under Application Support
 * and run that copy instead.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

export const OPEN_COMPUTER_USE_APP_NAME = "Open Computer Use.app";
export const OPEN_COMPUTER_USE_EXECUTABLE = "OpenComputerUse";

export interface OpenComputerUseInstallResult {
  appPath: string;
  binaryPath: string;
  sourcePath: string;
  updated: boolean;
}

function tryGetElectronApp():
  | { isPackaged?: boolean; getPath?: (name: string) => string }
  | undefined {
  try {
    const require = createRequire(import.meta.url);
    const electron = require("electron") as {
      app?: { isPackaged?: boolean; getPath?: (name: string) => string };
    };
    return electron.app;
  } catch {
    return undefined;
  }
}

/** Derive the .app bundle from .../Contents/MacOS/OpenComputerUse. */
export function openComputerUseAppBundleFromBinary(binaryPath: string): string | undefined {
  const macosDir = path.dirname(binaryPath);
  if (path.basename(macosDir) !== "MacOS") {
    return undefined;
  }
  const contentsDir = path.dirname(macosDir);
  if (path.basename(contentsDir) !== "Contents") {
    return undefined;
  }
  const appPath = path.dirname(contentsDir);
  if (!appPath.endsWith(".app")) {
    return undefined;
  }
  return appPath;
}

export function openComputerUseBinaryFromAppBundle(appPath: string): string {
  return path.join(appPath, "Contents", "MacOS", OPEN_COMPUTER_USE_EXECUTABLE);
}

export function defaultOpenComputerUseInstallRoot(userDataDir?: string): string {
  if (userDataDir?.trim()) {
    return path.join(userDataDir, "open-computer-use");
  }
  const app = tryGetElectronApp();
  try {
    const fromElectron = app?.getPath?.("userData");
    if (fromElectron?.trim()) {
      return path.join(fromElectron, "open-computer-use");
    }
  } catch {
    // app not ready
  }
  return path.join(os.homedir(), "Library", "Application Support", "Eco Coding", "open-computer-use");
}

export function installedOpenComputerUseAppPath(installRoot?: string): string {
  return path.join(installRoot ?? defaultOpenComputerUseInstallRoot(), OPEN_COMPUTER_USE_APP_NAME);
}

/** Packaged extraResources copy — never run this path for TCC-sensitive work. */
export function resolvePackagedOpenComputerUseAppSource(
  resourcesPath: string | null | undefined = typeof process.resourcesPath === "string"
    ? process.resourcesPath
    : undefined,
): string | undefined {
  if (!resourcesPath?.trim()) {
    return undefined;
  }
  const candidate = path.join(resourcesPath, "open-computer-use", "dist", OPEN_COMPUTER_USE_APP_NAME);
  return fs.existsSync(candidate) ? candidate : undefined;
}

export function openComputerUseBundleFingerprint(appPath: string): string | null {
  const files = [
    path.join(appPath, "Contents", "MacOS", OPEN_COMPUTER_USE_EXECUTABLE),
    path.join(appPath, "Contents", "Info.plist"),
    path.join(appPath, "Contents", "_CodeSignature", "CodeResources"),
  ];
  if (files.some((file) => !fs.existsSync(file))) {
    return null;
  }
  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(fs.readFileSync(file));
  }
  return hash.digest("hex");
}

/**
 * Copy the signed helper out of Eco Coding.app into a stable per-user path.
 * Returns null when there is no packaged source (dev / non-mac).
 */
export function installPackagedOpenComputerUse(options?: {
  resourcesPath?: string | null;
  installRoot?: string;
}): OpenComputerUseInstallResult | null {
  const sourcePath = resolvePackagedOpenComputerUseAppSource(
    options?.resourcesPath === undefined
      ? typeof process.resourcesPath === "string"
        ? process.resourcesPath
        : undefined
      : options.resourcesPath,
  );
  if (!sourcePath) {
    return null;
  }

  const installRoot = options?.installRoot ?? defaultOpenComputerUseInstallRoot();
  const appPath = installedOpenComputerUseAppPath(installRoot);
  const sourceFingerprint = openComputerUseBundleFingerprint(sourcePath);
  if (!sourceFingerprint) {
    throw new Error(`Packaged Open Computer Use helper is incomplete: ${sourcePath}`);
  }
  if (openComputerUseBundleFingerprint(appPath) === sourceFingerprint) {
    return {
      appPath,
      binaryPath: openComputerUseBinaryFromAppBundle(appPath),
      sourcePath,
      updated: false,
    };
  }

  fs.mkdirSync(installRoot, { recursive: true, mode: 0o700 });
  const suffix = `${process.pid}-${Date.now()}`;
  const stagingPath = `${appPath}.installing-${suffix}`;
  const backupPath = `${appPath}.previous-${suffix}`;
  fs.rmSync(stagingPath, { recursive: true, force: true });
  fs.rmSync(backupPath, { recursive: true, force: true });

  try {
    fs.cpSync(sourcePath, stagingPath, { recursive: true, preserveTimestamps: true });
    if (openComputerUseBundleFingerprint(stagingPath) !== sourceFingerprint) {
      throw new Error("Copied Open Computer Use helper failed integrity verification");
    }
    const executable = openComputerUseBinaryFromAppBundle(stagingPath);
    try {
      fs.chmodSync(executable, 0o755);
    } catch {
      // ignore
    }

    if (fs.existsSync(appPath)) {
      fs.renameSync(appPath, backupPath);
    }
    try {
      fs.renameSync(stagingPath, appPath);
    } catch (error) {
      if (fs.existsSync(backupPath) && !fs.existsSync(appPath)) {
        fs.renameSync(backupPath, appPath);
      }
      throw error;
    }
    fs.rmSync(backupPath, { recursive: true, force: true });
    return {
      appPath,
      binaryPath: openComputerUseBinaryFromAppBundle(appPath),
      sourcePath,
      updated: true,
    };
  } finally {
    fs.rmSync(stagingPath, { recursive: true, force: true });
  }
}

export function shouldPreferInstalledOpenComputerUse(): boolean {
  if (process.platform !== "darwin") {
    return false;
  }
  const app = tryGetElectronApp();
  return Boolean(app?.isPackaged);
}
