#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveElectronBuilderCliArgs } from "./pack-builder-args.mjs";
import { githubGenericPublishArgs, resolveGitHubRepository } from "./release-repository.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(scriptDir, "..");
const channel = process.env.ECO_RELEASE_CHANNEL?.trim() || "latest";
const repository = resolveGitHubRepository();

if (channel !== "beta" && channel !== "latest") {
  throw new Error(`Invalid ECO_RELEASE_CHANNEL: ${channel}`);
}

const { unpacked, args: platformArgs } = resolveElectronBuilderCliArgs(process.argv.slice(2));
if (unpacked) {
  console.log("Packing unpacked app only (--dir / --unpacked); skipping dmg/zip/installer artifacts.");
}

await rm(path.join(desktopRoot, "release"), { recursive: true, force: true });

const builderArgs = [
  ...platformArgs,
  "--publish",
  "never",
  `--config.publish.channel=${channel}`,
  ...githubGenericPublishArgs(repository),
];
const result = spawnSync("electron-builder", builderArgs, {
  cwd: desktopRoot,
  stdio: "inherit",
  shell: process.platform === "win32",
});

if (result.error) {
  throw result.error;
}
process.exit(result.status ?? 1);
