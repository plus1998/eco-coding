import { expect, test } from "bun:test";
import { resolveGitRemoteSyncAction } from "../src/renderer/WorkspaceGitSection";
import { getWorkspaceGitCommitEntryLabel } from "../src/renderer/workspace-git-action-store";
import { i18n } from "../src/renderer/i18n";

test("remote sync fetches until the local branch is behind", () => {
  expect(resolveGitRemoteSyncAction(0)).toBe("fetch");
  expect(resolveGitRemoteSyncAction(-1)).toBe("fetch");
  expect(resolveGitRemoteSyncAction(1)).toBe("pull");
  expect(resolveGitRemoteSyncAction(3)).toBe("pull");
});

test("work panel commit entry labels stay project-progress oriented", async () => {
  await i18n.changeLanguage("en-US");
  expect(getWorkspaceGitCommitEntryLabel(undefined)).toBe("Commit or push");
  expect(getWorkspaceGitCommitEntryLabel("generating")).toBe("Generating commit");
  expect(getWorkspaceGitCommitEntryLabel("committing")).toBe("Committing");
  expect(getWorkspaceGitCommitEntryLabel("pushing")).toBe("Pushing");
});
