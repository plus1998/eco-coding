import { FileDiff } from "lucide-react";
import { useCallback, useState } from "react";
import type { WorktreeMergeSummary } from "../shared/worktree-merge";
import { DiffReviewModal } from "./DiffReviewModal";

interface WorkspaceChangesCardProps {
  summary: WorktreeMergeSummary;
  threadId?: string;
}

function formatDiffStat(value: number): string {
  return value > 0 ? String(value) : "0";
}

export function WorkspaceChangesCard({ summary, threadId }: WorkspaceChangesCardProps) {
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewDiff, setReviewDiff] = useState("");
  const [error, setError] = useState<string | undefined>();

  const fileCount = summary.fileCount || summary.files.length;

  const openReview = useCallback(async () => {
    if (!threadId || !window.eco) {
      return;
    }
    setError(undefined);
    try {
      const applied = await window.eco.getThreadAppliedDiff(threadId);
      setReviewDiff(applied.diff);
      setReviewOpen(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }, [threadId]);

  return (
    <>
      <div
        className="workspace-changes-card codex-style"
        role="status"
        aria-label="工作区变更已合并"
      >
        <div className="workspace-changes-header">
          <div className="workspace-changes-header-main">
            <FileDiff size={16} className="workspace-changes-icon" aria-hidden />
            <div className="workspace-changes-title-wrap">
              <span className="workspace-changes-title">已编辑 {fileCount} 个文件</span>
              <span className="workspace-changes-totals" aria-label="变更行数">
                <span className="diff-stat-add">+{formatDiffStat(summary.totalAdditions)}</span>
                <span className="diff-stat-del">-{formatDiffStat(summary.totalDeletions)}</span>
              </span>
            </div>
          </div>
          {threadId ? (
            <div className="workspace-changes-actions">
              <button
                type="button"
                className="workspace-changes-review"
                onClick={() => void openReview()}
              >
                审核
              </button>
            </div>
          ) : null}
        </div>
        {summary.files.length > 0 ? (
          <ul className="workspace-changes-files">
            {summary.files.map((file) => (
              <li key={file.path} className="workspace-changes-file-row">
                <span className="workspace-changes-file-path" title={file.path}>
                  {file.path}
                </span>
                <span className="workspace-changes-file-stats">
                  <span className="diff-stat-add">+{formatDiffStat(file.additions)}</span>
                  <span className="diff-stat-del">-{formatDiffStat(file.deletions)}</span>
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        <p className="workspace-changes-note">未自动提交</p>
        {error ? (
          <p className="workspace-changes-error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
      {reviewOpen ? (
        <DiffReviewModal
          diff={reviewDiff}
          fileCount={fileCount}
          onClose={() => setReviewOpen(false)}
        />
      ) : null}
    </>
  );
}
