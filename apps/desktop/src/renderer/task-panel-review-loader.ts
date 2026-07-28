import type { WorkspaceDiffResult } from "../shared/ipc";

export async function loadTaskPanelReviewDiff({
  workspacePath,
  getWorkspaceDiff,
  isCurrent,
  onLoadingChange,
  onLoaded,
  onError,
}: {
  workspacePath: string;
  getWorkspaceDiff: (workspacePath: string) => Promise<WorkspaceDiffResult>;
  isCurrent: () => boolean;
  onLoadingChange: (loading: boolean) => void;
  onLoaded: (diff: WorkspaceDiffResult) => void | Promise<void>;
  onError: (message?: string) => void;
}): Promise<void> {
  onLoadingChange(true);
  onError(undefined);
  try {
    const diff = await getWorkspaceDiff(workspacePath);
    if (isCurrent()) {
      await onLoaded(diff);
    }
  } catch (caught) {
    if (isCurrent()) {
      onError(caught instanceof Error ? caught.message : String(caught));
    }
  } finally {
    if (isCurrent()) {
      onLoadingChange(false);
    }
  }
}
