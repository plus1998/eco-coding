import { expect, test } from "bun:test";
import { formatIpcInvokeError } from "../src/renderer/AppMessage";
import { i18n } from "../src/renderer/i18n";
import { resolveGitRemoteSyncAction } from "../src/renderer/WorkspaceGitSection";
import { getWorkspaceGitCommitEntryLabel } from "../src/renderer/workspace-git-action-store";

test("remote sync fetches until the local branch is behind", () => {
  expect(resolveGitRemoteSyncAction(0)).toBe("fetch");
  expect(resolveGitRemoteSyncAction(-1)).toBe("fetch");
  expect(resolveGitRemoteSyncAction(1)).toBe("pull");
  expect(resolveGitRemoteSyncAction(3)).toBe("pull");
});

test("formatIpcInvokeError strips Electron invoke wrapper", () => {
  expect(
    formatIpcInvokeError(
      new Error("Error invoking remote method 'git:pull': Error: Updating c9acc8b5..d8a206d5"),
    ),
  ).toBe("Updating c9acc8b5..d8a206d5");
  expect(formatIpcInvokeError(new Error(""), "同步远程失败")).toBe("同步远程失败");
});

test("work panel commit entry labels stay project-progress oriented", async () => {
  await i18n.changeLanguage("en-US");
  expect(getWorkspaceGitCommitEntryLabel(undefined)).toBe("Commit or push");
  expect(getWorkspaceGitCommitEntryLabel("generating")).toBe("Generating commit");
  expect(getWorkspaceGitCommitEntryLabel("committing")).toBe("Committing");
  expect(getWorkspaceGitCommitEntryLabel("pushing")).toBe("Pushing");
});
