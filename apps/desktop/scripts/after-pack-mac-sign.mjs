import { spawnSync } from "node:child_process";

export function shouldAdhocSignMac(context) {
  const identity = context.packager.platformSpecificBuildOptions?.identity;
  return identity == null || identity === "-";
}

export function adhocSignMacApp(appPath) {
  const sign = spawnSync("codesign", ["--force", "--deep", "--sign", "-", appPath], {
    stdio: "inherit",
  });
  if (sign.error) {
    throw sign.error;
  }
  if (sign.status !== 0) {
    throw new Error(`adhoc codesign failed for ${appPath} (exit ${sign.status})`);
  }

  const verify = spawnSync("codesign", ["--verify", "--deep", "--strict", appPath], {
    encoding: "utf8",
  });
  if (verify.status !== 0) {
    const detail = verify.stderr?.trim() || verify.stdout?.trim() || "unknown error";
    throw new Error(`adhoc codesign verification failed for ${appPath}: ${detail}`);
  }
}
