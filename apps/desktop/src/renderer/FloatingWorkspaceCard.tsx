import { ChevronDown, Minus } from "lucide-react";
import { type ReactNode, useCallback, useState } from "react";
import { persistCardExpanded, readCardExpanded } from "./workspace-floating-card-storage";

export interface FloatingWorkspaceCardProps {
  id: string;
  title: string;
  bubble: ReactNode;
  children: ReactNode;
  defaultExpanded?: boolean;
  className?: string;
  headerAction?: ReactNode;
  maxBodyHeight?: number;
}

export function FloatingWorkspaceCard({
  id,
  title,
  bubble,
  children,
  defaultExpanded = true,
  className,
  headerAction,
  maxBodyHeight = 360,
}: FloatingWorkspaceCardProps) {
  const [expanded, setExpanded] = useState(() => readCardExpanded(id, defaultExpanded));

  const toggleExpanded = useCallback(() => {
    setExpanded((current) => {
      const next = !current;
      persistCardExpanded(id, next);
      return next;
    });
  }, [id]);

  const collapse = useCallback(() => {
    setExpanded(false);
    persistCardExpanded(id, false);
  }, [id]);

  if (!expanded) {
    return (
      <button
        type="button"
        className={["floating-workspace-card", "is-collapsed", className].filter(Boolean).join(" ")}
        aria-label={`展开${title}`}
        aria-expanded={false}
        onClick={toggleExpanded}
      >
        <span className="floating-workspace-card-bubble">{bubble}</span>
        <ChevronDown size={13} className="floating-workspace-card-bubble-chevron" aria-hidden />
      </button>
    );
  }

  return (
    <section
      className={["floating-workspace-card", "is-expanded", className].filter(Boolean).join(" ")}
      aria-label={title}
    >
      <header className="floating-workspace-card-header">
        <h3 className="floating-workspace-card-title">{title}</h3>
        <div className="floating-workspace-card-header-actions">
          {headerAction}
          <button
            type="button"
            className="floating-workspace-card-collapse"
            onClick={collapse}
            aria-label={`收起${title}`}
            title="收起"
          >
            <Minus size={14} aria-hidden />
          </button>
        </div>
      </header>
      <div
        className="floating-workspace-card-body"
        style={maxBodyHeight > 0 ? { maxHeight: maxBodyHeight } : undefined}
      >
        {children}
      </div>
    </section>
  );
}
