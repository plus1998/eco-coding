import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, test } from "bun:test";
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
  await store.saveScriptArgs(workspace, "publish", "root@xxx");
  expect(await store.getWorkspaceArgs(workspace)).toEqual({ publish: "root@xxx" });
  await store.saveScriptArgs(workspace, "dev", "--watch");
  expect(await store.getWorkspaceArgs(workspace)).toEqual({
    publish: "root@xxx",
    dev: "--watch",
  });
  await store.saveScriptArgs(workspace, "dev", "   ");
  expect(await store.getWorkspaceArgs(workspace)).toEqual({ publish: "root@xxx" });
});
