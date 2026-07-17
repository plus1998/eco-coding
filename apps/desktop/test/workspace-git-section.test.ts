import { expect, test } from "bun:test";
import { resolveGitRemoteSyncAction } from "../src/renderer/WorkspaceGitSection";

test("remote sync fetches until the local branch is behind", () => {
  expect(resolveGitRemoteSyncAction(0)).toBe("fetch");
  expect(resolveGitRemoteSyncAction(-1)).toBe("fetch");
  expect(resolveGitRemoteSyncAction(1)).toBe("pull");
  expect(resolveGitRemoteSyncAction(3)).toBe("pull");
});
