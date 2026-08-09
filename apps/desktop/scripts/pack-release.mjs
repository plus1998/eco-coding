#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(scriptDir, "..");
const channel = process.env.ECO_RELEASE_CHANNEL?.trim() || "latest";

if (channel !== "beta" && channel !== "latest") {
  throw new Error(`Invalid ECO_RELEASE_CHANNEL: ${channel}`);
}

await rm(path.join(desktopRoot, "release"), { recursive: true, force: true });

const builderArgs = [...process.argv.slice(2), "--publish", "never", `--config.publish.channel=${channel}`];
const result = spawnSync("electron-builder", builderArgs, {
  cwd: desktopRoot,
  stdio: "inherit",
  shell: process.platform === "win32",
});

if (result.error) {
  throw result.error;
}
process.exit(result.status ?? 1);
