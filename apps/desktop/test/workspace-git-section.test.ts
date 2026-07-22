import { expect, test } from "bun:test";
import { resolveGitRemoteSyncAction } from "../src/renderer/WorkspaceGitSection";
import { getWorkspaceGitCommitEntryLabel } from "../src/renderer/workspace-git-action-store";

test("remote sync fetches until the local branch is behind", () => {
  expect(resolveGitRemoteSyncAction(0)).toBe("fetch");
  expect(resolveGitRemoteSyncAction(-1)).toBe("fetch");
  expect(resolveGitRemoteSyncAction(1)).toBe("pull");
  expect(resolveGitRemoteSyncAction(3)).toBe("pull");
});

test("work panel commit entry labels stay project-progress oriented", () => {
  expect(getWorkspaceGitCommitEntryLabel(undefined)).toBe("提交或推送");
  expect(getWorkspaceGitCommitEntryLabel("generating")).toBe("正在生成提交");
  expect(getWorkspaceGitCommitEntryLabel("committing")).toBe("正在提交");
  expect(getWorkspaceGitCommitEntryLabel("pushing")).toBe("正在推送");
});
