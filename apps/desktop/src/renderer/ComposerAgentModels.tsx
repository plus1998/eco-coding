import { shortenModelId } from "@eco/runtime";
import { Users } from "lucide-react";
import {
  type CSSProperties,
  type FocusEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import type { SubagentEnabledSettings, SubagentRole } from "../shared/ipc";
import type { ComposerAgentModelLabel } from "./composer-agent-model-labels";
import { composerFloatingStyleForAnchor } from "./composer-floating";

function rowClassName(options: {
  subagent: boolean;
  enabled: boolean;
  clickable: boolean;
  planner: boolean;
}): string {
  const parts = ["composer-agent-row"];
  if (options.planner) {
    parts.push("is-main", "is-active");
    return parts.join(" ");
  }
  if (options.subagent) {
    parts.push(options.enabled ? "is-active" : "is-disabled");
    if (options.clickable) {
      parts.push("is-clickable");
    }
  }
  return parts.join(" ");
}

interface ComposerAgentModelsProps {
  labels: ComposerAgentModelLabel[];
  subagentSettings: SubagentEnabledSettings | null;
  canEditSubagents: boolean;
  subagentSaving?: boolean | undefined;
  onToggleSubagent?: (role: SubagentRole, enabled: boolean) => void;
}

function AgentRowContent({
  displayName,
  modelShort,
  status,
  action,
}: {
  displayName: string;
  modelShort: string;
  status: string;
  action?: string | undefined;
}) {
  return (
    <>
      <span className="composer-agent-row-main">
        <span className="composer-agent-row-role">{displayName}</span>
        <span className="composer-agent-row-model">{modelShort}</span>
      </span>
      <span className={action ? "composer-agent-row-meta is-actionable" : "composer-agent-row-meta"}>
        <span className="composer-agent-row-status">{status}</span>
        {action ? <span className="composer-agent-row-action">{action}</span> : null}
      </span>
    </>
  );
}

export function ComposerAgentModels({
  labels,
  subagentSettings,
  canEditSubagents,
  subagentSaving,
  onToggleSubagent,
}: ComposerAgentModelsProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [hovered, setHovered] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [panelStyle, setPanelStyle] = useState<CSSProperties>(() => ({ visibility: "hidden" }));
  const open = hovered || pinned;
  const subagentLabels = labels.filter((label) => !label.main);
  const enabledSubagents = subagentLabels.filter(
    ({ subagentRole }) => !subagentRole || !subagentSettings || subagentSettings[subagentRole],
  ).length;
  const totalSubagents = subagentLabels.length;
  const summary = totalSubagents > 0 ? `${enabledSubagents}/${totalSubagents}` : String(labels.length);

  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const updatePanelPosition = useCallback(() => {
    const anchor = triggerRef.current;
    if (!anchor) {
      return;
    }
    setPanelStyle(
      composerFloatingStyleForAnchor(anchor, {
        width: 340,
        minHeight: 180,
        prefer: "above",
      }),
    );
  }, []);

  const showPanel = useCallback(() => {
    clearCloseTimer();
    updatePanelPosition();
    setHovered(true);
  }, [clearCloseTimer, updatePanelPosition]);

  const scheduleClose = useCallback(() => {
    if (pinned) {
      return;
    }
    clearCloseTimer();
    closeTimerRef.current = setTimeout(() => {
      setHovered(false);
      closeTimerRef.current = null;
    }, 120);
  }, [clearCloseTimer, pinned]);

  const closePanel = useCallback(() => {
    clearCloseTimer();
    setHovered(false);
    setPinned(false);
  }, [clearCloseTimer]);

  const handleBlur = useCallback(
    (event: FocusEvent<HTMLElement>) => {
      const nextTarget = event.relatedTarget as Node | null;
      if (
        nextTarget &&
        (triggerRef.current?.contains(nextTarget) || panelRef.current?.contains(nextTarget))
      ) {
        return;
      }
      scheduleClose();
    },
    [scheduleClose],
  );

  useLayoutEffect(() => {
    if (!open) {
      return;
    }
    updatePanelPosition();
    window.addEventListener("resize", updatePanelPosition);
    window.addEventListener("scroll", updatePanelPosition, true);
    return () => {
      window.removeEventListener("resize", updatePanelPosition);
      window.removeEventListener("scroll", updatePanelPosition, true);
    };
  }, [open, updatePanelPosition]);

  useEffect(() => {
    return () => clearCloseTimer();
  }, [clearCloseTimer]);

  useEffect(() => {
    if (!open) {
      return;
    }
    function onPointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) {
        return;
      }
      closePanel();
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        closePanel();
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [closePanel, open]);

  const popover =
    open &&
    createPortal(
      <div
        ref={panelRef}
        className="composer-agents-popover"
        role="dialog"
        aria-label="子代理编排详情"
        style={panelStyle}
        onMouseEnter={showPanel}
        onMouseLeave={scheduleClose}
        onFocus={showPanel}
        onBlur={handleBlur}
      >
        <div className="composer-agents-popover-header">
          <span>子代理编排</span>
          <span>{summary}</span>
        </div>
        <div className="composer-agents-list">
          {labels.map(({ role, displayName, modelId, title, main, subagentRole }) => {
            const subagent = !main;
            const enabled = subagentRole && subagentSettings ? subagentSettings[subagentRole] : true;
            const clickable = Boolean(
              canEditSubagents && subagentRole && subagentSettings && onToggleSubagent,
            );
            const modelShort = modelId?.trim() ? shortenModelId(modelId.trim()) : "未配置";
            const className = rowClassName({ subagent, enabled, clickable, planner: main });
            const status = main ? "主 Agent" : enabled ? "启用" : "停用";
            const action = clickable ? (enabled ? "点击停用" : "点击启用") : undefined;
            const content = (
              <AgentRowContent
                displayName={displayName}
                modelShort={modelShort}
                status={status}
                action={action}
              />
            );
            const tip = main
              ? title
              : clickable
                ? enabled
                  ? `${title} · 点击停用`
                  : `${title} · 点击启用`
                : title;

            if (clickable && subagentRole) {
              return (
                <button
                  key={role}
                  type="button"
                  className={className}
                  title={tip}
                  disabled={subagentSaving}
                  aria-pressed={enabled}
                  onClick={() => onToggleSubagent?.(subagentRole, !enabled)}
                >
                  {content}
                </button>
              );
            }

            return (
              <span key={role} className={className} title={tip}>
                {content}
              </span>
            );
          })}
        </div>
      </div>,
      document.body,
    );

  return (
    <span className="composer-agents-control">
      <button
        ref={triggerRef}
        type="button"
        className={
          open
            ? "composer-meta-pill composer-agents-trigger is-clickable is-active"
            : "composer-meta-pill composer-agents-trigger is-clickable"
        }
        aria-label={`查看子代理编排详情，已启用 ${summary}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onMouseEnter={showPanel}
        onMouseLeave={scheduleClose}
        onFocus={showPanel}
        onBlur={handleBlur}
        onClick={() => {
          if (pinned) {
            closePanel();
            return;
          }
          updatePanelPosition();
          setHovered(true);
          setPinned(true);
        }}
      >
        <Users size={14} aria-hidden className="composer-agents-trigger-icon" />
        <span>编排</span>
        <span className="composer-agents-trigger-count">{summary}</span>
      </button>
      {popover}
    </span>
  );
}
