#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { dump, load } from "js-yaml";

const args = parseArgs(process.argv.slice(2));
const channel = args.channel;
const arm64Directory = args.arm64;
const x64Directory = args.x64;
const outputDirectory = args.output;
const fileName = channel === "beta" ? "beta-mac.yml" : "latest-mac.yml";

if (channel !== "beta" && channel !== "latest") {
  throw new Error(`Invalid channel: ${channel}`);
}

const [arm64, x64] = await Promise.all([
  readMetadata(path.join(arm64Directory, fileName)),
  readMetadata(path.join(x64Directory, fileName)),
]);

if (arm64.version !== x64.version) {
  throw new Error(`macOS metadata versions differ: ${arm64.version} vs ${x64.version}`);
}

const files = [...(arm64.files ?? []), ...(x64.files ?? [])].filter(
  (file) => typeof file?.url === "string" && file.url.endsWith(".zip"),
);
if (files.length === 0) {
  throw new Error("macOS update metadata contains no files.");
}

const seen = new Set();
for (const file of files) {
  if (!file || typeof file !== "object" || typeof file.url !== "string") {
    throw new Error("macOS update metadata contains an invalid file entry.");
  }
  if (!file.url.endsWith(".zip")) {
    throw new Error(`macOS update metadata must contain ZIP files: ${file.url}`);
  }
  if (typeof file.sha512 !== "string" || !file.sha512 || !Number.isFinite(file.size)) {
    throw new Error(`macOS update file is missing checksum or size: ${file.url}`);
  }
  if (seen.has(file.url)) {
    throw new Error(`Duplicate macOS update file: ${file.url}`);
  }
  seen.add(file.url);
}

const arm64Files = files.filter((file) => file.url.includes("arm64"));
const x64Files = files.filter((file) => file.url.includes("x64") && !file.url.includes("arm64"));
if (arm64Files.length === 0 || x64Files.length === 0) {
  throw new Error(
    `Expected both macOS architectures; got arm64=${arm64Files.length}, x64=${x64Files.length}`,
  );
}

const { path: _path, sha512: _sha512, sha2: _sha2, size: _size, ...shared } = arm64;
const merged = {
  ...shared,
  files,
};

await mkdir(outputDirectory, { recursive: true });
await writeFile(path.join(outputDirectory, fileName), dump(merged, { noRefs: true }), "utf8");
console.log(`Merged ${fileName}: ${arm64.version}, files=${files.length}`);

async function readMetadata(filePath) {
  const value = load(await readFile(filePath, "utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Invalid YAML metadata: ${filePath}`);
  }
  return value;
}

function parseArgs(values) {
  const result = {};
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index];
    const value = values[index + 1];
    if (!key?.startsWith("--") || !value || value.startsWith("--")) {
      throw new Error(
        "Usage: merge-mac-update-metadata.mjs --channel beta|latest --arm64 DIR --x64 DIR --output DIR",
      );
    }
    result[key.slice(2)] = value;
  }
  if (!result.channel || !result.arm64 || !result.x64 || !result.output) {
    throw new Error("Missing required metadata merge arguments.");
  }
  return result;
}
