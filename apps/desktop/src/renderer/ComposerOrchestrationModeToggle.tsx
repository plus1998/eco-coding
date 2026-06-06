import { useCallback, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { OrchestrationModeSetting } from "../shared/ipc";
import {
  orchestrationModeUi,
  toggleOrchestrationMode,
} from "../shared/orchestration-mode-ui";

interface ComposerOrchestrationModeToggleProps {
  orchestrationMode: OrchestrationModeSetting;
  canEdit: boolean;
  saving?: boolean | undefined;
  onToggle: (mode: OrchestrationModeSetting) => void;
}

export function ComposerOrchestrationModeToggle({
  orchestrationMode,
  canEdit,
  saving,
  onToggle,
}: ComposerOrchestrationModeToggleProps) {
  const wrapRef = useRef<HTMLSpanElement>(null);
  const [hovered, setHovered] = useState(false);
  const [tooltipPos, setTooltipPos] = useState({ top: 0, left: 0 });

  const isManual = orchestrationMode === "manual";
  const clickable = canEdit && !saving;
  const current = orchestrationModeUi(orchestrationMode);
  const next = orchestrationModeUi(toggleOrchestrationMode(orchestrationMode));
  const className = [
    "composer-meta-pill",
    "composer-orchestration-pill",
    isManual ? "is-manual" : "is-autonomous",
    clickable ? "is-clickable" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const updateTooltipPosition = useCallback(() => {
    const el = wrapRef.current;
    if (!el) {
      return;
    }
    const rect = el.getBoundingClientRect();
    setTooltipPos({
      top: rect.bottom + 8,
      left: rect.left + rect.width / 2,
    });
  }, []);

  const showTooltip = useCallback(() => {
    updateTooltipPosition();
    setHovered(true);
  }, [updateTooltipPosition]);

  const hideTooltip = useCallback(() => {
    setHovered(false);
  }, []);

  const tooltip =
    hovered &&
    createPortal(
      <span
        className="composer-meta-tooltip"
        role="tooltip"
        style={{
          position: "fixed",
          top: tooltipPos.top,
          left: tooltipPos.left,
          transform: "translateX(-50%)",
        }}
      >
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
            当前对话进行中，编排模式不可修改
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
      aria-pressed={isManual}
      aria-label={current.title}
      onClick={() => onToggle(toggleOrchestrationMode(orchestrationMode))}
      {...controlProps}
    >
      {current.title}
    </button>
  ) : (
    <span className={className} aria-label={current.title} {...controlProps}>
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
