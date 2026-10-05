import { afterEach, beforeEach, expect, test } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  createPackageScriptArgsStore,
  normalizePackageScriptArgsStore,
} from "../src/main/package-script-args-store";

let tempDir = "";

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "eco-package-script-args-"));
});

afterEach(async () => {
  await fs.rm(tempDir, { recursive: true, force: true });
});

test("normalizePackageScriptArgsStore drops empty values", () => {
  expect(
    normalizePackageScriptArgsStore({
      "/repo": {
        publish: " root@xxx ",
        blank: "   ",
        notString: 1,
      },
    }),
  ).toEqual({
    "/repo": {
      publish: "root@xxx",
    },
  });
});

test("PackageScriptArgsStore persists and reads per workspace script", async () => {
  const store = createPackageScriptArgsStore(path.join(tempDir, "args.json"));
  const workspace = path.join(tempDir, "repo");
  await store.saveScriptOverrides(workspace, "publish", { args: "root@xxx" });
  expect(await store.getWorkspaceOverrides(workspace)).toEqual({
    args: { publish: "root@xxx" },
    prefixes: {},
  });
  await store.saveScriptOverrides(workspace, "dev", { args: "--watch" });
  expect(await store.getWorkspaceOverrides(workspace)).toEqual({
    args: { publish: "root@xxx", dev: "--watch" },
    prefixes: {},
  });
  await store.saveScriptOverrides(workspace, "dev", { args: "   " });
  expect(await store.getWorkspaceOverrides(workspace)).toEqual({
    args: { publish: "root@xxx" },
    prefixes: {},
  });
});

test("saveScriptOverrides keeps omitted fields and clears blank ones", async () => {
  const store = createPackageScriptArgsStore(path.join(tempDir, "overrides.json"));
  const workspace = path.join(tempDir, "repo");
  await store.saveScriptOverrides(workspace, "dev", { args: "--watch", prefix: "nvm use 20" });

  // Mobile / older clients only send args: the saved prefix must survive.
  await store.saveScriptOverrides(workspace, "dev", { args: "--port 3000" });
  expect(await store.getWorkspaceOverrides(workspace)).toEqual({
    args: { dev: "--port 3000" },
    prefixes: { dev: "nvm use 20" },
  });

  await store.saveScriptOverrides(workspace, "dev", { prefix: "" });
  expect(await store.getWorkspaceOverrides(workspace)).toEqual({
    args: { dev: "--port 3000" },
    prefixes: {},
  });
});

test("store writes a versioned envelope and reloads args + prefixes", async () => {
  const filePath = path.join(tempDir, "overrides.json");
  const store = createPackageScriptArgsStore(filePath);
  const workspace = path.join(tempDir, "repo");
  await store.saveScriptOverrides(workspace, "dev", { args: "--watch", prefix: "nvm use 20" });

  const raw = JSON.parse(await fs.readFile(filePath, "utf8")) as Record<string, unknown>;
  expect(raw.version).toBe(2);

  const reloaded = createPackageScriptArgsStore(filePath);
  expect(await reloaded.getWorkspaceOverrides(workspace)).toEqual({
    args: { dev: "--watch" },
    prefixes: { dev: "nvm use 20" },
  });
});

test("legacy flat args file migrates into the v2 envelope", async () => {
  const filePath = path.join(tempDir, "package-script-args.json");
  const workspace = path.join(tempDir, "repo");
  await fs.writeFile(filePath, JSON.stringify({ [workspace]: { dev: "--watch" } }), "utf8");

  const store = createPackageScriptArgsStore(filePath);
  expect(await store.getWorkspaceOverrides(workspace)).toEqual({
    args: { dev: "--watch" },
    prefixes: {},
  });

  await store.saveScriptOverrides(workspace, "dev", { prefix: "nvm use 18" });
  const raw = JSON.parse(await fs.readFile(filePath, "utf8")) as Record<string, unknown>;
  expect(raw.version).toBe(2);
  expect(raw.prefixes).toEqual({ [workspace]: { dev: "nvm use 18" } });
});

test("replaceAll keeps prefixes when the cloud snapshot predates prefixes", async () => {
  const store = createPackageScriptArgsStore(path.join(tempDir, "overrides.json"));
  const workspace = path.join(tempDir, "repo");
  await store.saveScriptOverrides(workspace, "dev", { args: "--watch", prefix: "nvm use 20" });

  const current = store.getAllSnapshotSync();
  await store.replaceAll({ args: { [workspace]: { build: "tsc -b" } }, prefixes: current.prefixes });

  expect(await store.getWorkspaceOverrides(workspace)).toEqual({
    args: { build: "tsc -b" },
    prefixes: { dev: "nvm use 20" },
  });
});
