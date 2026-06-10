import { type CSSProperties, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { BashReviewMode } from "../../../../packages/bash-policy/src";
import { bashReviewUi, cycleBashReviewMode } from "../shared/bash-review-ui";
import { composerFloatingStyleForAnchor } from "./composer-floating";

interface ComposerBashReviewToggleProps {
  bashReviewMode: BashReviewMode;
  canEdit: boolean;
  saving?: boolean | undefined;
  onToggle: (bashReviewMode: BashReviewMode) => void;
}

export function ComposerBashReviewToggle({
  bashReviewMode,
  canEdit,
  saving,
  onToggle,
}: ComposerBashReviewToggleProps) {
  const wrapRef = useRef<HTMLSpanElement>(null);
  const [hovered, setHovered] = useState(false);
  const [tooltipStyle, setTooltipStyle] = useState<CSSProperties>(() => ({
    visibility: "hidden",
  }));

  const clickable = canEdit && !saving;
  const current = bashReviewUi(bashReviewMode);
  const next = bashReviewUi(cycleBashReviewMode(bashReviewMode));
  const className = [
    "composer-meta-pill",
    "composer-orchestration-pill",
    `bash-review-${bashReviewMode}`,
    clickable ? "is-clickable" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const updateTooltipPosition = useCallback(() => {
    const el = wrapRef.current;
    if (!el) {
      return;
    }
    setTooltipStyle(composerFloatingStyleForAnchor(el, { width: 280, minHeight: 112, prefer: "above" }));
  }, []);

  const showTooltip = useCallback(() => {
    updateTooltipPosition();
    setHovered(true);
  }, [updateTooltipPosition]);

  const hideTooltip = useCallback(() => {
    setHovered(false);
  }, []);

  useEffect(() => {
    if (!hovered) {
      return;
    }
    updateTooltipPosition();
    window.addEventListener("resize", updateTooltipPosition);
    window.addEventListener("scroll", updateTooltipPosition, true);
    return () => {
      window.removeEventListener("resize", updateTooltipPosition);
      window.removeEventListener("scroll", updateTooltipPosition, true);
    };
  }, [hovered, updateTooltipPosition]);

  const tooltip =
    hovered &&
    createPortal(
      <span className="composer-meta-tooltip" role="tooltip" style={tooltipStyle}>
        <span className="composer-meta-tooltip-line">
          <strong>{current.title}</strong>
          <span className="composer-meta-tooltip-subtitle">{current.subtitle}</span>
        </span>
        <span className="composer-meta-tooltip-line composer-meta-tooltip-desc">{current.description}</span>
        {clickable ? (
          <span className="composer-meta-tooltip-line composer-meta-tooltip-action">
            点击切换为 {next.title}
          </span>
        ) : (
          <span className="composer-meta-tooltip-line composer-meta-tooltip-action">
            当前对话进行中，Bash 审查模式不可修改
          </span>
        )}
      </span>,
      document.body,
    );

  const controlProps = {
    onMouseEnter: showTooltip,
    onMouseLeave: hideTooltip,
    onFocus: showTooltip,
    onBlur: hideTooltip,
  };

  const control = clickable ? (
    <button
      type="button"
      className={className}
      disabled={saving}
      aria-pressed={bashReviewMode !== "allow_all"}
      aria-label={current.title}
      onClick={() => onToggle(cycleBashReviewMode(bashReviewMode))}
      {...controlProps}
    >
      {current.title}
    </button>
  ) : (
    <span className={className} {...controlProps}>
      {current.title}
    </span>
  );

  return (
    <>
      <span ref={wrapRef} className="composer-orchestration-wrap">
        {control}
      </span>
      {tooltip}
    </>
  );
}
