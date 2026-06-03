import { X } from "lucide-react";
import { useEffect } from "react";

interface DiffReviewModalProps {
  diff: string;
  fileCount: number;
  onClose: () => void;
}

export function DiffReviewModal({ diff, fileCount, onClose }: DiffReviewModalProps) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="diff-review-overlay" role="presentation" onClick={onClose}>
      <div
        className="diff-review-modal codex-style"
        role="dialog"
        aria-modal="true"
        aria-label="审核变更"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="diff-review-header">
          <h3>审核变更</h3>
          <span className="diff-review-meta">{fileCount} 个文件</span>
          <button type="button" className="diff-review-close" onClick={onClose} aria-label="关闭">
            <X size={18} />
          </button>
        </header>
        <pre className="diff-review-body">{diff.trim() || "（无 diff 内容）"}</pre>
      </div>
    </div>
  );
}
