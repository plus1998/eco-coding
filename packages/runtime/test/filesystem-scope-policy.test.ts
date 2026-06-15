import { expect, test } from "bun:test";
import os from "node:os";
import {
  expandHomeInPolicyPath,
  filesystemReadScopeAskReason,
  isPathInsidePolicyScope,
  resolveFilesystemScopeRoot,
  resolvePolicyPath,
} from "../src/filesystem-scope-policy.js";

test("expandHomeInPolicyPath expands tilde and $HOME prefixes", () => {
  const homedir = os.homedir().replace(/\\/g, "/");
  expect(expandHomeInPolicyPath("~/.claude/skills/foo")).toBe(`${homedir}/.claude/skills/foo`);
  expect(expandHomeInPolicyPath("$HOME/.agents/skills/bar")).toBe(`${homedir}/.agents/skills/bar`);
});

test("resolvePolicyPath expands tilde before resolving against cwd", () => {
  const homedir = os.homedir().replace(/\\/g, "/");
  expect(resolvePolicyPath("~/.claude/skills/foo/SKILL.md", "/repo")).toBe(
    `${homedir}/.claude/skills/foo/SKILL.md`,
  );
});

test("resolveFilesystemScopeRoot expands to parent cwd for subdirectory workspaces", () => {
  expect(
    resolveFilesystemScopeRoot(
      "/repo/apps/desktop",
      "/repo",
    ),
  ).toBe("/repo");
});

test("filesystemReadScopeAskReason describes approval intent", () => {
  expect(filesystemReadScopeAskReason("Glob", "/repo", "/repo/apps/desktop")).toContain("Approve");
});

test("isPathInsidePolicyScope treats workspace descendants as inside", () => {
  expect(isPathInsidePolicyScope("/repo/apps/desktop/src", "/repo/apps/desktop")).toBe(true);
  expect(isPathInsidePolicyScope("/repo/other", "/repo/apps/desktop")).toBe(false);
});
