#!/usr/bin/env node
/**
 * Pack the desktop app for the current host OS/arch only.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(scriptDir, "..");

const TARGETS = {
  "darwin:arm64": ["--mac", "dmg", "--arm64"],
  "win32:x64": ["--win", "nsis", "--x64"],
  "linux:x64": ["--linux", "AppImage", "--x64"],
};

const key = `${process.platform}:${process.arch}`;
const args = TARGETS[key];
if (!args) {
  console.error(
    `Unsupported host for local packaging: ${process.platform} ${process.arch}. ` +
      `Supported: ${Object.keys(TARGETS).join(", ")}`,
  );
  process.exit(1);
}

const result = spawnSync("electron-builder", args, {
  cwd: desktopRoot,
  stdio: "inherit",
  shell: process.platform === "win32",
});
process.exit(result.status ?? 1);
