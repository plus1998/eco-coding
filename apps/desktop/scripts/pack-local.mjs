#!/usr/bin/env node
/**
 * Pack the desktop app for the current host OS/arch only.
 *
 * Pass `--dir` or `--unpacked` to skip installer artifacts (dmg / nsis / AppImage).
 */
import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveElectronBuilderCliArgs } from "./pack-builder-args.mjs";
import { githubGenericPublishArgs, resolveGitHubRepository } from "./release-repository.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(scriptDir, "..");

const TARGETS = {
  "darwin:arm64": ["--mac", "dmg", "--arm64"],
  "darwin:x64": ["--mac", "dmg", "--x64"],
  "win32:x64": ["--win", "nsis", "--x64"],
  "linux:x64": ["--linux", "AppImage", "--x64"],
};

const key = `${process.platform}:${process.arch}`;
const hostArgs = TARGETS[key];
const repository = resolveGitHubRepository();
if (!hostArgs) {
  console.error(
    `Unsupported host for local packaging: ${process.platform} ${process.arch}. ` +
      `Supported: ${Object.keys(TARGETS).join(", ")}`,
  );
  process.exit(1);
}

const { unpacked, args } = resolveElectronBuilderCliArgs([...hostArgs, ...process.argv.slice(2)]);
if (unpacked) {
  console.log("Packing unpacked app only (--dir / --unpacked); skipping dmg/zip/installer artifacts.");
}

rmSync(path.join(desktopRoot, "release"), { recursive: true, force: true });

const result = spawnSync(
  "electron-builder",
  [...args, "--publish", "never", ...githubGenericPublishArgs(repository)],
  {
    cwd: desktopRoot,
    stdio: "inherit",
    shell: process.platform === "win32",
  },
);
process.exit(result.status ?? 1);
