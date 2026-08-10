#!/usr/bin/env node
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { load } from "js-yaml";

const args = parseArgs(process.argv.slice(2));
const directory = path.resolve(args.directory);
const version = args.version;
const channel = args.channel;
const names = new Set(await readdir(directory));
const macChannelFile = channel === "beta" ? "beta-mac.yml" : "latest-mac.yml";
const winChannelFile = channel === "beta" ? "beta.yml" : "latest.yml";
const linuxChannelFile = channel === "beta" ? "beta-linux.yml" : "latest-linux.yml";

if (channel !== "beta" && channel !== "latest") {
  throw new Error(`Invalid channel: ${channel}`);
}

const required = [
  `Eco-Coding-${version}-mac-arm64.dmg`,
  `Eco-Coding-${version}-mac-arm64.zip`,
  `Eco-Coding-${version}-mac-arm64.zip.blockmap`,
  `Eco-Coding-${version}-mac-x64.dmg`,
  `Eco-Coding-${version}-mac-x64.zip`,
  `Eco-Coding-${version}-mac-x64.zip.blockmap`,
  `Eco-Coding-${version}-win-x64.exe`,
  `Eco-Coding-${version}-win-x64.exe.blockmap`,
  `Eco-Coding-${version}-linux-x64.AppImage`,
  macChannelFile,
  winChannelFile,
  linuxChannelFile,
  "SHA256SUMS",
];
for (const name of required) {
  if (!names.has(name)) {
    throw new Error(`Missing release asset: ${name}`);
  }
}

const unexpectedAssets = [...names].filter((name) => !required.includes(name));
if (unexpectedAssets.length > 0) {
  throw new Error(`Unexpected release assets: ${unexpectedAssets.join(", ")}`);
}

const wrongChannelFiles = [
  "beta.yml",
  "latest.yml",
  "beta-mac.yml",
  "latest-mac.yml",
  "beta-linux.yml",
  "latest-linux.yml",
].filter((name) => names.has(name) && ![macChannelFile, winChannelFile, linuxChannelFile].includes(name));
if (wrongChannelFiles.length > 0) {
  throw new Error(`Unexpected channel metadata: ${wrongChannelFiles.join(", ")}`);
}

for (const fileName of [macChannelFile, winChannelFile, linuxChannelFile]) {
  const metadata = load(await readFile(path.join(directory, fileName), "utf8"));
  if (!metadata || typeof metadata !== "object" || metadata.version !== version) {
    throw new Error(`Invalid metadata version in ${fileName}.`);
  }
  if (!Array.isArray(metadata.files) || metadata.files.length === 0) {
    throw new Error(`No files listed in ${fileName}.`);
  }
  for (const file of metadata.files) {
    if (typeof file?.url !== "string" || typeof file.sha512 !== "string" || !Number.isFinite(file.size)) {
      throw new Error(`Invalid file entry in ${fileName}.`);
    }
    if (fileName === macChannelFile && !file.url.endsWith(".zip")) {
      throw new Error(`${fileName} must reference ZIP update files: ${file.url}`);
    }
    if (!names.has(file.url)) {
      throw new Error(`${fileName} references missing asset ${file.url}.`);
    }
  }
}

const macMetadata = load(await readFile(path.join(directory, macChannelFile), "utf8"));
const macUrls = macMetadata.files.map((file) => file.url);
if (
  !macUrls.some((url) => url.includes("arm64")) ||
  !macUrls.some((url) => url.includes("x64") && !url.includes("arm64"))
) {
  throw new Error(`${macChannelFile} does not contain both macOS architectures.`);
}

console.log(`Validated ${names.size} release assets for ${version} (${channel}).`);

function parseArgs(values) {
  const result = {};
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index];
    const value = values[index + 1];
    if (!key?.startsWith("--") || !value || value.startsWith("--")) {
      throw new Error(
        "Usage: validate-release-assets.mjs --directory DIR --version VERSION --channel beta|latest",
      );
    }
    result[key.slice(2)] = value;
  }
  if (!result.directory || !result.version || !result.channel) {
    throw new Error("Missing required release asset arguments.");
  }
  return result;
}
