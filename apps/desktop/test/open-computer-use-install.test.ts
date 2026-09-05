import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  installPackagedOpenComputerUse,
  openComputerUseAppBundleFromBinary,
  openComputerUseBinaryFromAppBundle,
  openComputerUseBundleFingerprint,
  resolvePackagedOpenComputerUseAppSource,
} from "../src/main/open-computer-use-install";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function makeFakeAppBundle(root: string, stamp: string): string {
  const appPath = path.join(root, "Open Computer Use.app");
  const macOs = path.join(appPath, "Contents", "MacOS");
  const sig = path.join(appPath, "Contents", "_CodeSignature");
  fs.mkdirSync(macOs, { recursive: true });
  fs.mkdirSync(sig, { recursive: true });
  fs.writeFileSync(path.join(macOs, "OpenComputerUse"), `#!/bin/sh\necho ${stamp}\n`);
  fs.chmodSync(path.join(macOs, "OpenComputerUse"), 0o755);
  fs.writeFileSync(path.join(appPath, "Contents", "Info.plist"), `<plist>${stamp}</plist>`);
  fs.writeFileSync(path.join(sig, "CodeResources"), `resources:${stamp}`);
  return appPath;
}

test("openComputerUseAppBundleFromBinary walks Contents/MacOS", () => {
  const binary =
    "/tmp/Open Computer Use.app/Contents/MacOS/OpenComputerUse";
  expect(openComputerUseAppBundleFromBinary(binary)).toBe("/tmp/Open Computer Use.app");
  expect(openComputerUseAppBundleFromBinary("/usr/bin/OpenComputerUse")).toBeUndefined();
});

test("installPackagedOpenComputerUse copies helper out of Resources and skips when unchanged", () => {
  const resources = fs.mkdtempSync(path.join(os.tmpdir(), "eco-ocu-res-"));
  const installRoot = fs.mkdtempSync(path.join(os.tmpdir(), "eco-ocu-install-"));
  tempRoots.push(resources, installRoot);

  const sourceRoot = path.join(resources, "open-computer-use", "dist");
  fs.mkdirSync(sourceRoot, { recursive: true });
  const sourceApp = makeFakeAppBundle(sourceRoot, "v1");
  expect(resolvePackagedOpenComputerUseAppSource(resources)).toBe(sourceApp);

  const first = installPackagedOpenComputerUse({ resourcesPath: resources, installRoot });
  expect(first).not.toBeNull();
  expect(first!.updated).toBe(true);
  expect(first!.appPath).toBe(path.join(installRoot, "Open Computer Use.app"));
  expect(fs.existsSync(openComputerUseBinaryFromAppBundle(first!.appPath))).toBe(true);
  expect(openComputerUseBundleFingerprint(first!.appPath)).toBe(
    openComputerUseBundleFingerprint(sourceApp),
  );

  const second = installPackagedOpenComputerUse({ resourcesPath: resources, installRoot });
  expect(second!.updated).toBe(false);

  makeFakeAppBundle(sourceRoot, "v2");
  const third = installPackagedOpenComputerUse({ resourcesPath: resources, installRoot });
  expect(third!.updated).toBe(true);
  expect(fs.readFileSync(path.join(third!.appPath, "Contents", "Info.plist"), "utf8")).toContain(
    "v2",
  );
});

test("openComputerUseBundleFingerprint changes when executable changes", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "eco-ocu-fp-"));
  tempRoots.push(root);
  const app = makeFakeAppBundle(root, "a");
  const before = openComputerUseBundleFingerprint(app);
  fs.writeFileSync(path.join(app, "Contents", "MacOS", "OpenComputerUse"), "changed");
  const after = openComputerUseBundleFingerprint(app);
  expect(before).not.toBe(after);
  expect(before).toHaveLength(64);
  expect(createHash("sha256").update("x").digest("hex")).toHaveLength(64);
});
