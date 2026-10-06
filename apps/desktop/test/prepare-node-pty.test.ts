import { afterEach, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import afterPack from "../scripts/after-pack.mjs";
import { ensureNodePtySpawnHelpersExecutable, resolveNativeBuildSdkRoot } from "../scripts/prepare-node-pty.mjs";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function packageRoot() {
  const root = mkdtempSync(path.join(tmpdir(), "eco-node-pty-test-"));
  roots.push(root);
  return root;
}

test.skipIf(process.platform === "win32")("fixes rebuilt and prebuilt Darwin helpers while preserving other mode bits", () => {
  const root = packageRoot();
  const files = ["build/Release", "prebuilds/darwin-arm64", "prebuilds/darwin-x64"].map((directory) => {
    const file = path.join(root, directory, "spawn-helper");
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, "helper");
    chmodSync(file, 0o640);
    return file;
  });
  expect(ensureNodePtySpawnHelpersExecutable(root, "darwin")).toEqual(files);
  for (const file of files) expect(statSync(file).mode & 0o777).toBe(0o751);
  expect(ensureNodePtySpawnHelpersExecutable(root, "darwin")).toEqual(files);
});

test.skipIf(process.platform === "win32")("prepares the shipped helper even when Developer ID signing is configured", async () => {
  const root = packageRoot();
  const helper = path.join(root, "Eco Coding.app/Contents/Resources/app.asar.unpacked/node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper");
  mkdirSync(path.dirname(helper), { recursive: true });
  writeFileSync(helper, "helper");
  chmodSync(helper, 0o644);
  await afterPack({
    electronPlatformName: "darwin",
    appOutDir: root,
    packager: {
      appInfo: { productFilename: "Eco Coding" },
      platformSpecificBuildOptions: { identity: "Developer ID Application: Test" },
    },
  });
  expect(statSync(helper).mode & 0o777).toBe(0o755);
});

test("fails packing when a native PTY binary has no corresponding helper", () => {
  const root = packageRoot();
  const directory = path.join(root, "build/Release");
  mkdirSync(directory, { recursive: true });
  writeFileSync(path.join(directory, "pty.node"), "native module");
  expect(() => ensureNodePtySpawnHelpersExecutable(root, "darwin")).toThrow("spawn-helper is missing");
});

test("fails if the Darwin package has no helper rather than shipping a broken terminal", () => {
  expect(() => ensureNodePtySpawnHelpersExecutable(packageRoot(), "darwin")).toThrow("No Darwin node-pty spawn-helper");
});

test("does not require a Darwin helper on Windows or Linux", () => {
  const root = packageRoot();
  expect(ensureNodePtySpawnHelpersExecutable(root, "win32")).toEqual([]);
  expect(ensureNodePtySpawnHelpersExecutable(root, "linux")).toEqual([]);
});

test("uses the SDK from the selected developer tools", () => {
  const env = { DEVELOPER_DIR: "/Selected/Xcode" };
  const calls: unknown[][] = [];
  const sdk = resolveNativeBuildSdkRoot("darwin", env, (...args: unknown[]) => {
    calls.push(args);
    return { status: 0, stdout: "/Selected/MacOSX.sdk\n", stderr: "" };
  });
  expect(sdk).toBe("/Selected/MacOSX.sdk");
  expect(calls).toEqual([["xcrun", ["--sdk", "macosx", "--show-sdk-path"], { encoding: "utf8", env }]]);
});

test("respects an explicit SDKROOT and does not resolve an Apple SDK on other platforms", () => {
  const unexpectedRun = () => { throw new Error("xcrun should not run"); };
  expect(resolveNativeBuildSdkRoot("darwin", { SDKROOT: "/Custom/SDK" }, unexpectedRun)).toBe("/Custom/SDK");
  expect(resolveNativeBuildSdkRoot("win32", {}, unexpectedRun)).toBeUndefined();
  expect(resolveNativeBuildSdkRoot("linux", {}, unexpectedRun)).toBeUndefined();
});

test("propagates SDK selection failures without trying an unrelated SDK", () => {
  expect(() => resolveNativeBuildSdkRoot("darwin", {}, () => ({ status: 1, stdout: "", stderr: "Xcode not selected" }))).toThrow("Xcode not selected");
  expect(() => resolveNativeBuildSdkRoot("darwin", {}, () => ({ status: 0, stdout: "", stderr: "" }))).toThrow("xcrun returned no SDK");
  expect(() => resolveNativeBuildSdkRoot("darwin", {}, () => ({ error: new Error("xcrun missing") }))).toThrow("xcrun missing");
});
