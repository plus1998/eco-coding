import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, statSync } from "node:fs";
import path from "node:path";

/** node-pty 1.1.0's Darwin prebuilds ship spawn-helper with mode 0644 (#850). */
export function ensureNodePtySpawnHelpersExecutable(packageRoot, platform = process.platform) {
  if (platform !== "darwin") return [];

  const directories = ["build/Release", "build/Debug", "prebuilds/darwin-arm64", "prebuilds/darwin-x64"];
  const helpers = [];
  for (const directory of directories) {
    const helper = path.join(packageRoot, directory, "spawn-helper");
    if (!existsSync(helper)) {
      if (existsSync(path.join(packageRoot, directory, "pty.node"))) {
        throw new Error(`node-pty spawn-helper is missing: ${helper}`);
      }
      continue;
    }
    const info = statSync(helper);
    if (!info.isFile()) throw new Error(`node-pty spawn-helper is not a file: ${helper}`);
    const mode = info.mode & 0o777;
    if ((mode & 0o111) !== 0o111) chmodSync(helper, mode | 0o111);
    helpers.push(helper);
  }
  if (helpers.length === 0) throw new Error(`No Darwin node-pty spawn-helper found in ${packageRoot}`);
  return helpers;
}

/** Keep the SDK aligned with the selected Apple developer tools; respect an explicit SDKROOT. */
export function resolveNativeBuildSdkRoot(platform, env, run = spawnSync) {
  if (platform !== "darwin") return undefined;
  if (env.SDKROOT?.trim()) return env.SDKROOT;
  const result = run("xcrun", ["--sdk", "macosx", "--show-sdk-path"], { encoding: "utf8", env });
  if (result.error) throw result.error;
  const sdkRoot = result.stdout?.trim();
  if (result.status !== 0 || !sdkRoot) {
    throw new Error(`Unable to resolve the selected macOS SDK: ${result.stderr?.trim() || "xcrun returned no SDK"}`);
  }
  return sdkRoot;
}
