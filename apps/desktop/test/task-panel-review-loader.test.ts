import { describe, expect, mock, test } from "bun:test";
import { loadTaskPanelReviewDiff } from "../src/renderer/task-panel-review-loader";
import type { WorkspaceDiffResult } from "../src/shared/ipc";

const diff: WorkspaceDiffResult = {
  diff: "diff --git a/a.ts b/a.ts",
  files: [],
  fileCount: 1,
  totalAdditions: 1,
  totalDeletions: 0,
  truncated: false,
};

describe("task panel review loader", () => {
  test("loads workspace changes when Review opens", async () => {
    const loading = mock(() => {});
    const loaded = mock(() => {});
    const error = mock(() => {});

    await loadTaskPanelReviewDiff({
      workspacePath: "/workspace",
      getWorkspaceDiff: mock(async () => diff),
      isCurrent: () => true,
      onLoadingChange: loading,
      onLoaded: loaded,
      onError: error,
    });

    expect(loading).toHaveBeenNthCalledWith(1, true);
    expect(loading).toHaveBeenNthCalledWith(2, false);
    expect(loaded).toHaveBeenCalledWith(diff);
    expect(error).toHaveBeenCalledWith(undefined);
  });

  test("ignores a stale result after the active project changes", async () => {
    const loading = mock(() => {});
    const loaded = mock(() => {});
    let current = true;

    await loadTaskPanelReviewDiff({
      workspacePath: "/old-workspace",
      getWorkspaceDiff: async () => {
        current = false;
        return diff;
      },
      isCurrent: () => current,
      onLoadingChange: loading,
      onLoaded: loaded,
      onError: mock(() => {}),
    });

    expect(loaded).not.toHaveBeenCalled();
    expect(loading).toHaveBeenCalledTimes(1);
  });
});
