#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const bundlePath = path.resolve(scriptDirectory, "../dist/main/index.js");
const bundle = await readFile(bundlePath, "utf8");

if (/import\s*\{[^}]*\bautoUpdater\b[^}]*\}\s*from\s*["']electron-updater["']/.test(bundle)) {
  throw new Error(
    "Main bundle uses a named electron-updater import, which fails when Electron loads its CommonJS entrypoint.",
  );
}

if (!/import\s+\w+\s+from\s+["']electron-updater["']/.test(bundle)) {
  throw new Error("Main bundle is missing the CommonJS-compatible electron-updater default import.");
}

console.log("Verified main bundle CommonJS interoperability.");
