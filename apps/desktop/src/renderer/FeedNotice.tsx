import { CircleAlert, X } from "lucide-react";
import type { ReactNode } from "react";
import "./FeedNotice.css";

export interface FeedNoticeAction {
  label: string;
  onClick: () => void;
}

export interface FeedNoticeProps {
  title: ReactNode;
  description: ReactNode;
  icon?: ReactNode;
  primaryAction?: FeedNoticeAction;
  dismissAction?: FeedNoticeAction;
  role?: "status" | "alert";
  className?: string;
}

export function FeedNotice({
  title,
  description,
  icon = <CircleAlert size={20} strokeWidth={1.8} aria-hidden />,
  primaryAction,
  dismissAction,
  role = "status",
  className,
}: FeedNoticeProps) {
  const hasActions = Boolean(primaryAction || dismissAction);

  return (
    <section
      className={["feed-notice", className].filter(Boolean).join(" ")}
      role={role}
      aria-live={role === "alert" ? "assertive" : "polite"}
    >
      <div className="feed-notice-surface">
        <div className="feed-notice-content">
          <span className="feed-notice-icon">{icon}</span>
          <div className="feed-notice-copy">
            <h2 className="feed-notice-title">{title}</h2>
            <div className="feed-notice-description">{description}</div>
          </div>
        </div>

        {hasActions ? (
          <div className="feed-notice-actions">
            {primaryAction ? (
              <button type="button" className="feed-notice-primary-action" onClick={primaryAction.onClick}>
                {primaryAction.label}
              </button>
            ) : null}
            {dismissAction ? (
              <button
                type="button"
                className="feed-notice-dismiss-action"
                onClick={dismissAction.onClick}
                aria-label={dismissAction.label}
                title={dismissAction.label}
              >
                <X size={18} strokeWidth={1.8} aria-hidden />
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
