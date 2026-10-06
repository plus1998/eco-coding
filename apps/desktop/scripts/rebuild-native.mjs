import { rebuild } from "@electron/rebuild";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ensureNodePtySpawnHelpersExecutable, resolveNativeBuildSdkRoot } from "./prepare-node-pty.mjs";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(desktopRoot, "package.json"));
const sdkRoot = resolveNativeBuildSdkRoot(process.platform, process.env);
if (sdkRoot) {
  process.env.SDKROOT = sdkRoot;
  console.log(`[native] macOS SDK: ${sdkRoot}`);
}

const electronVersion = require("electron/package.json").version;
console.log(`[native] Rebuilding node-pty for Electron ${electronVersion}`);
await rebuild({ buildPath: desktopRoot, electronVersion, force: true, onlyModules: ["node-pty"] });

const packageRoot = path.dirname(require.resolve("node-pty/package.json"));
ensureNodePtySpawnHelpersExecutable(packageRoot);
console.log("[native] node-pty rebuild and spawn-helper preparation complete");
