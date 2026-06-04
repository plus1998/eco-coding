#!/usr/bin/env node
/**
 * Install the platform-specific Claude Agent SDK native CLI before electron-builder
 * packages for a target OS/arch (needed when cross-building, e.g. Linux AppImage on macOS).
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "../../..");

const PACKAGES = {
  "darwin-arm64": "@anthropic-ai/claude-agent-sdk-darwin-arm64@0.3.153",
  "linux-x64": "@anthropic-ai/claude-agent-sdk-linux-x64@0.3.153",
  "win-x64": "@anthropic-ai/claude-agent-sdk-win32-x64@0.3.153",
};

const target = process.argv[2];
const pkg = PACKAGES[target];
if (!pkg) {
  console.error(`Usage: ensure-native-sdk.mjs <${Object.keys(PACKAGES).join("|")}>`);
  process.exit(1);
}

const result = spawnSync("bun", ["add", "--no-save", pkg], {
  cwd: repoRoot,
  stdio: "inherit",
});
if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

console.log(`Native SDK ready for ${target}: ${pkg}`);
