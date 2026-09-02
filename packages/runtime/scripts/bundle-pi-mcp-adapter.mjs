#!/usr/bin/env node
/**
 * Transpile pi-mcp-adapter (ships as TypeScript source) into a Node-loadable ESM file.
 * Electron/Node cannot strip types from node_modules; Eco loads this vendor file instead.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const runtimeRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const vendorDir = path.join(runtimeRoot, "vendor");
const outfile = path.join(vendorDir, "pi-mcp-adapter.js");

fs.mkdirSync(vendorDir, { recursive: true });

const resolve = spawnSync(
  "bun",
  [
    "-e",
    'import { fileURLToPath } from "node:url"; console.log(fileURLToPath(import.meta.resolve("pi-mcp-adapter")));',
  ],
  { cwd: runtimeRoot, encoding: "utf8" },
);
if (resolve.status !== 0) {
  console.error(resolve.stderr || resolve.stdout);
  process.exit(resolve.status ?? 1);
}
const sourceEntry = resolve.stdout.trim();
if (!sourceEntry || !fs.existsSync(sourceEntry)) {
  console.error(`Could not resolve pi-mcp-adapter entry: ${sourceEntry}`);
  process.exit(1);
}

// Bundle TS sources + JS deps into one ESM file. Keep native keyring external.
const build = spawnSync(
  "bun",
  [
    "build",
    sourceEntry,
    "--target=node",
    "--format=esm",
    `--outfile=${outfile}`,
    "--packages=bundle",
    "--external",
    "@napi-rs/keyring",
  ],
  { cwd: runtimeRoot, encoding: "utf8" },
);
if (build.status !== 0) {
  console.error(build.stderr || build.stdout);
  process.exit(build.status ?? 1);
}

const packageDir = path.dirname(sourceEntry);
for (const companion of ["mcp-script-worker.mjs", "mcp-keyring-helper.cjs"]) {
  const src = path.join(packageDir, companion);
  const dest = path.join(vendorDir, companion);
  if (!fs.existsSync(src)) {
    console.error(`Missing pi-mcp-adapter companion file: ${src}`);
    process.exit(1);
  }
  fs.copyFileSync(src, dest);
  console.log(`Copied ${companion} -> ${path.relative(runtimeRoot, dest)}`);
}

const stat = fs.statSync(outfile);
console.log(
  `Bundled pi-mcp-adapter -> ${path.relative(runtimeRoot, outfile)} (${(stat.size / (1024 * 1024)).toFixed(2)} MiB)`,
);
