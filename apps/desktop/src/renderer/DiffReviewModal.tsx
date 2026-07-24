import { X } from "lucide-react";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";

interface DiffReviewModalProps {
  diff: string;
  fileCount: number;
  onClose: () => void;
}

export function DiffReviewModal({ diff, fileCount, onClose }: DiffReviewModalProps) {
  const { t } = useTranslation();
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
        aria-label={t("workspace.diff.review")}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="diff-review-header">
          <h3>{t("workspace.diff.review")}</h3>
          <span className="diff-review-meta">
            {t("workspace.diff.fileCount", { count: fileCount })}
          </span>
          <button
            type="button"
            className="diff-review-close"
            onClick={onClose}
            aria-label={t("common.close")}
          >
            <X size={18} />
          </button>
        </header>
        <pre className="diff-review-body">
          {diff.trim() || t("workspace.diff.emptyContent")}
        </pre>
      </div>
    </div>
  );
}
