import { Loader2, Maximize2, Minimize2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ThreadPendingPlan } from "../shared/ipc";
import { MAIN_SHELL_MEDIA_QUERIES } from "./activity-workspace-layout";
import { MarkdownContent } from "./MarkdownContent";

interface PlanApprovalPanelProps {
  plan: ThreadPendingPlan;
  busy?: boolean | undefined;
  failureMessage?: string | undefined;
  variant?: "feed" | "dock";
  onApprove: () => void;
  onDismiss: () => void;
  onOpenInPanel?: () => void;
}

export function PlanApprovalPanel({
  plan,
  busy,
  failureMessage,
  variant = "feed",
  onApprove,
  onDismiss,
  onOpenInPanel,
}: PlanApprovalPanelProps) {
  const { t } = useTranslation();
  const planTrimmed = plan.plan.trim();
  const docked = variant === "dock";
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia(MAIN_SHELL_MEDIA_QUERIES.taskOverlay);
    const collapseOnWide = () => {
      if (!mediaQuery.matches) {
        setExpanded(false);
      }
    };
    collapseOnWide();
    mediaQuery.addEventListener("change", collapseOnWide);
    return () => mediaQuery.removeEventListener("change", collapseOnWide);
  }, []);

  const expandLabel = expanded ? t("approval.plan.collapse") : t("approval.plan.expand");

  const body = (
    <>
      <header className="plan-approval-header">
        <h3 className={docked ? "plan-approval-dock-title" : undefined}>{t("approval.plan.title")}</h3>
        <div className="plan-approval-header-actions">
          {docked ? (
            <button
              type="button"
              className="plan-approval-expand"
              onClick={() => setExpanded((current) => !current)}
              title={expandLabel}
              aria-label={expandLabel}
              aria-expanded={expanded}
            >
              {expanded ? <Minimize2 size={15} aria-hidden /> : <Maximize2 size={15} aria-hidden />}
            </button>
          ) : null}
          {onOpenInPanel ? (
            <button
              type="button"
              className="plan-approval-open-panel"
              onClick={onOpenInPanel}
              title={t("approval.plan.open")}
              aria-label={t("approval.plan.open")}
            >
              <Maximize2 size={15} aria-hidden />
            </button>
          ) : null}
        </div>
      </header>
      {failureMessage ? (
        <div className="plan-approval-error" role="alert">
          <strong>{t("approval.plan.lastFailed")}</strong>
          <p>{failureMessage}</p>
        </div>
      ) : null}
      <div
        className={["plan-approval-markdown", docked ? "plan-approval-dock-markdown" : ""]
          .filter(Boolean)
          .join(" ")}
      >
        <MarkdownContent text={plan.plan} />
      </div>
      <footer className={docked ? "bash-approval-footer plan-approval-dock-footer" : "plan-approval-actions"}>
        <button
          type="button"
          className={docked ? "bash-approval-dismiss" : "plan-button secondary"}
          onClick={onDismiss}
          disabled={busy}
        >
          {busy ? (
            <>
              <Loader2 size={14} className="spinning" aria-hidden />
              {t("common.processing")}
            </>
          ) : (
            t("common.dismiss")
          )}
        </button>
        {!failureMessage ? (
          <button
            type="button"
            className={docked ? "bash-approval-submit" : "plan-button primary"}
            onClick={onApprove}
            disabled={busy || !planTrimmed}
          >
            {busy ? (
              <>
                <Loader2 size={14} className="spinning" aria-hidden />
                {t("common.processing")}
              </>
            ) : docked ? (
              <>
                {t("approval.plan.execute")} <kbd aria-hidden>↵</kbd>
              </>
            ) : (
              t("approval.plan.execute")
            )}
          </button>
        ) : null}
      </footer>
    </>
  );

  if (docked) {
    return (
      <div
        className={["codex-composer", "is-compact", "plan-approval-dock-shell", expanded ? "is-expanded" : ""]
          .filter(Boolean)
          .join(" ")}
      >
        <div className="composer-primary plan-approval-dock-inner">{body}</div>
      </div>
    );
  }

  return (
    <section className="plan-approval" aria-label={t("approval.plan.title")}>
      {body}
    </section>
  );
}
