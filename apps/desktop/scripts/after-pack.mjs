#!/usr/bin/env node
/**
 * Post-pack hooks for unsigned local/CI builds:
 * - win32: embed icon when signAndEditExecutable is off
 * - darwin: adhoc re-sign so Gatekeeper does not report "damaged" after browser download
 */
import path from "node:path";
import rcedit from "rcedit";
import { adhocSignMacApp, shouldAdhocSignMac } from "./after-pack-mac-sign.mjs";

export default async function afterPack(context) {
  const platform = context.electronPlatformName;

  if (platform === "win32") {
    const productFilename = context.packager.appInfo.productFilename;
    const exePath = path.join(context.appOutDir, `${productFilename}.exe`);
    const iconPath = path.join(context.packager.buildResourcesDir, "icon.ico");
    await rcedit(exePath, { icon: iconPath });
    return;
  }

  if (platform === "darwin" && shouldAdhocSignMac(context)) {
    const productFilename = context.packager.appInfo.productFilename;
    const appPath = path.join(context.appOutDir, `${productFilename}.app`);
    adhocSignMacApp(appPath);
  }
}
