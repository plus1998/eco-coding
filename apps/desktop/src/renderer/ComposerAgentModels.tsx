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
import { SUBAGENT_ROLES, type AgentRole, type SubagentEnabledSettings, type SubagentRole } from "../shared/ipc";
import { composerFloatingStyleForAnchor } from "./composer-floating";

const ROLE_LABELS: Record<AgentRole, string> = {
  planner: "主代理",
  explore: "探索",
  architect: "架构",
  coder: "编码",
  reviewer: "审查",
  tester: "测试",
};

function isSubagentRole(role: AgentRole): role is SubagentRole {
  return (SUBAGENT_ROLES as readonly string[]).includes(role);
}

function rowClassName(options: {
  subagent: boolean;
  enabled: boolean;
  clickable: boolean;
  locked: boolean;
  planner: boolean;
}): string {
  const parts = ["composer-agent-row"];
  if (options.planner) {
    parts.push("is-main", "is-active");
    return parts.join(" ");
  }
  if (options.subagent) {
    parts.push(options.enabled ? "is-active" : "is-disabled");
    if (options.clickable && !options.locked) {
      parts.push("is-clickable");
    }
    if (options.locked) {
      parts.push("is-locked");
    }
  }
  return parts.join(" ");
}

interface ComposerAgentModelsProps {
  labels: Array<{ role: AgentRole; modelId?: string | undefined; title: string }>;
  subagentSettings: SubagentEnabledSettings | null;
  canEditSubagents: boolean;
  subagentSaving?: boolean | undefined;
  onToggleSubagent?: (role: SubagentRole, enabled: boolean) => void;
}

function AgentRowContent({
  role,
  modelShort,
  status,
  action,
}: {
  role: AgentRole;
  modelShort: string;
  status: string;
  action?: string | undefined;
}) {
  return (
    <>
      <span className="composer-agent-row-main">
        <span className="composer-agent-row-role">{ROLE_LABELS[role]}</span>
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
  const subagentLabels = labels.filter(({ role }) => isSubagentRole(role));
  const enabledSubagents = subagentLabels.filter(
    ({ role }) => !isSubagentRole(role) || !subagentSettings || subagentSettings[role],
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
  }, [labels.length, open, updatePanelPosition]);

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
        aria-label="角色路由详情"
        style={panelStyle}
        onMouseEnter={showPanel}
        onMouseLeave={scheduleClose}
        onFocus={showPanel}
        onBlur={handleBlur}
      >
        <div className="composer-agents-popover-header">
          <span>角色路由</span>
          <span>{summary}</span>
        </div>
        <div className="composer-agents-list">
          {labels.map(({ role, modelId, title }) => {
            const planner = role === "planner";
            const subagent = isSubagentRole(role);
            const enabled = subagent && subagentSettings ? subagentSettings[role] : true;
            const locked = role === "coder";
            const clickable = Boolean(
              canEditSubagents && subagent && subagentSettings && onToggleSubagent && !locked,
            );
            const modelShort = modelId?.trim() ? shortenModelId(modelId.trim()) : "未配置";
            const className = rowClassName({ subagent, enabled, clickable, locked, planner });
            const status = planner ? "主线" : locked ? "必需" : enabled ? "开启" : "关闭";
            const action = clickable ? (enabled ? "点击关闭" : "点击开启") : undefined;
            const content = (
              <AgentRowContent
                role={role}
                modelShort={modelShort}
                status={status}
                action={action}
              />
            );
            const tip = planner
              ? title
              : locked
                ? "编码子代理不可关闭"
                : clickable
                  ? enabled
                    ? `${title} · 点击关闭`
                    : `${title} · 点击开启`
                  : title;

            if (clickable && subagent) {
              return (
                <button
                  key={role}
                  type="button"
                  className={className}
                  title={tip}
                  disabled={subagentSaving}
                  aria-pressed={enabled}
                  onClick={() => onToggleSubagent?.(role, !enabled)}
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
        aria-label={`查看角色路由详情，已启用 ${summary}`}
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
        <span>角色</span>
        <span className="composer-agents-trigger-count">{summary}</span>
      </button>
      {popover}
    </span>
  );
}
