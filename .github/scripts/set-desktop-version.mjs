#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";

const version = process.env.ECO_RELEASE_VERSION?.trim();
if (!version) {
  throw new Error("ECO_RELEASE_VERSION is required.");
}

const filePath = "apps/desktop/package.json";
const packageJson = JSON.parse(await readFile(filePath, "utf8"));
packageJson.version = version;
await writeFile(filePath, `${JSON.stringify(packageJson, null, 2)}\n`, "utf8");
console.log(`Set desktop package version to ${version}`);
