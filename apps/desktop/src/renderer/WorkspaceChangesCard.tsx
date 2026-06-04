import { FileDiff, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { WorktreeMergeSummary } from "../shared/worktree-merge";
import { DiffReviewModal } from "./DiffReviewModal";

interface WorkspaceChangesCardProps {
  summary: WorktreeMergeSummary;
  threadId?: string;
  rolledBack?: boolean;
  onReverted?: () => void;
}

function formatDiffStat(value: number): string {
  return value > 0 ? String(value) : "0";
}

export function WorkspaceChangesCard({
  summary,
  threadId,
  rolledBack = false,
  onReverted,
}: WorkspaceChangesCardProps) {
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewDiff, setReviewDiff] = useState("");
  const [busy, setBusy] = useState(false);
  const [reverted, setReverted] = useState(rolledBack);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    setReverted(rolledBack);
  }, [rolledBack]);

  useEffect(() => {
    if (!threadId || !window.eco) {
      return;
    }
    let cancelled = false;
    void window.eco.getThreadAppliedDiff(threadId).then((applied) => {
      if (cancelled) {
        return;
      }
      if (applied.rolledBackAt) {
        setReverted(true);
      }
    }).catch(() => {
      // No applied diff for this thread — keep default display.
    });
    return () => {
      cancelled = true;
    };
  }, [threadId]);

  const fileCount = summary.fileCount || summary.files.length;
  const canAct = Boolean(threadId) && !reverted;

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

  const handleRevert = useCallback(async () => {
    if (!threadId || !window.eco || busy || reverted) {
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      await window.eco.revertThreadAppliedDiff(threadId);
      setReverted(true);
      onReverted?.();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }, [busy, onReverted, reverted, threadId]);

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
              <span className="workspace-changes-title">
                {reverted ? "已撤销合并" : `已编辑 ${fileCount} 个文件`}
              </span>
              {!reverted ? (
                <span className="workspace-changes-totals" aria-label="变更行数">
                  <span className="diff-stat-add">+{formatDiffStat(summary.totalAdditions)}</span>
                  <span className="diff-stat-del">-{formatDiffStat(summary.totalDeletions)}</span>
                </span>
              ) : null}
            </div>
          </div>
          {canAct ? (
            <div className="workspace-changes-actions">
              <button
                type="button"
                className="workspace-changes-link"
                onClick={() => void handleRevert()}
                disabled={busy}
              >
                <RotateCcw size={14} aria-hidden />
                {busy ? "撤销中…" : "撤销"}
              </button>
              <button
                type="button"
                className="workspace-changes-review"
                onClick={() => void openReview()}
                disabled={busy}
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
        {reverted ? <p className="workspace-changes-note">未自动提交 · 变更已从工作区撤销</p> : (
          <p className="workspace-changes-note">未自动提交</p>
        )}
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
