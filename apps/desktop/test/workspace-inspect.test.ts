import { describe, expect, test } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { findGitRootOnDisk, inspectWorkspace } from "../src/main/workspace-inspect";

describe("findGitRootOnDisk", () => {
  test("finds .git in parent when cwd is a subfolder", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "eco-git-root-"));
    await fs.mkdir(path.join(root, ".git"));
    const nested = path.join(root, "packages", "app");
    await fs.mkdir(nested, { recursive: true });

    expect(await findGitRootOnDisk(nested)).toBe(root);
  });
});

describe("inspectWorkspace", () => {
  test("marks temp repo with .git as git repository", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "eco-inspect-"));
    await fs.mkdir(path.join(root, ".git"));
    await fs.writeFile(path.join(root, ".git", "HEAD"), "ref: refs/heads/main\n");

    const info = await inspectWorkspace(root);
    expect(info.isGitRepository).toBe(true);
    expect(info.gitRoot).toBe(root);
    expect(info.branch).toBe("main");
  });
});
