#!/usr/bin/env node
/** Embed win.icon into the main exe when signAndEditExecutable is off (unsigned local/CI). */
import path from "node:path";
import rcedit from "rcedit";

export default async function afterPack(context) {
  if (context.electronPlatformName !== "win32") {
    return;
  }

  const productFilename = context.packager.appInfo.productFilename;
  const exePath = path.join(context.appOutDir, `${productFilename}.exe`);
  const iconPath = path.join(context.packager.buildResourcesDir, "icon.ico");
  await rcedit(exePath, { icon: iconPath });
}
