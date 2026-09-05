#!/usr/bin/env node
/**
 * Copy the host-platform open-computer-use native binary into packaging/open-computer-use
 * for electron-builder extraResources (avoid shipping every OS binary).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(scriptDir, "..");
const outDir = path.join(desktopRoot, "packaging", "open-computer-use");

function nativeRelativePath(platform, arch) {
  const key = `${platform}-${arch === "x86_64" ? "x64" : arch}`;
  switch (key) {
    case "darwin-arm64":
    case "darwin-x64":
      return ["dist", "Open Computer Use.app", "Contents", "MacOS", "OpenComputerUse"];
    case "linux-arm64":
      return ["dist", "linux", "arm64", "open-computer-use"];
    case "linux-x64":
      return ["dist", "linux", "amd64", "open-computer-use"];
    case "win32-arm64":
      return ["dist", "windows", "arm64", "open-computer-use.exe"];
    case "win32-x64":
      return ["dist", "windows", "amd64", "open-computer-use.exe"];
    default:
      return undefined;
  }
}

const relative = nativeRelativePath(process.platform, process.arch);
if (!relative) {
  console.error(`No open-computer-use binary mapping for ${process.platform}/${process.arch}`);
  process.exit(1);
}

const packageRoots = [
  path.join(desktopRoot, "node_modules", "@qwen-code", "open-computer-use"),
  path.join(desktopRoot, "..", "..", "node_modules", "@qwen-code", "open-computer-use"),
];

const packageRoot = packageRoots.find((candidate) => fs.existsSync(path.join(candidate, "package.json")));
if (!packageRoot) {
  console.error(
    "open-computer-use package not found. Install @qwen-code/open-computer-use dependency first.",
  );
  process.exit(1);
}

const source = path.join(packageRoot, ...relative);
if (!fs.existsSync(source)) {
  console.error(`open-computer-use native binary not found at ${source}`);
  process.exit(1);
}

fs.mkdirSync(outDir, { recursive: true });
const destName = process.platform === "win32" ? "open-computer-use.exe" : "open-computer-use";
const dest = path.join(outDir, destName);
fs.copyFileSync(source, dest);
try {
  fs.chmodSync(dest, 0o755);
} catch {
  // Windows
}
console.log(`Prepared ${dest} from ${source}`);
