import type { PlanDelegationAgentOption } from "@eco/runtime/forced-plan-delegation";
import { ChevronDown, Loader2, Maximize2, Minimize2 } from "lucide-react";
import { type KeyboardEvent as ReactKeyboardEvent, useEffect, useId, useRef, useState } from "react";
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
  /**
   * Approved with an explicit delegation target. Only rendered when the thread's locked
   * orchestration snapshot exposes at least one enabled, delegation-capable subagent.
   */
  onApproveWithSubagent?: ((agentKey: string, additionalMessage?: string) => void) | undefined;
  delegationAgents?: readonly PlanDelegationAgentOption[] | undefined;
  additionalMessage?: string | undefined;
  onAdditionalMessageChange?: ((value: string) => void) | undefined;
  onDismiss: () => void;
  onOpenInPanel?: () => void;
}

export function PlanApprovalPanel({
  plan,
  busy,
  failureMessage,
  variant = "feed",
  onApprove,
  onApproveWithSubagent,
  delegationAgents,
  additionalMessage,
  onAdditionalMessageChange,
  onDismiss,
  onOpenInPanel,
}: PlanApprovalPanelProps) {
  const { t } = useTranslation();
  const planTrimmed = plan.plan.trim();
  const docked = variant === "dock";
  const [expanded, setExpanded] = useState(false);
  const [delegationOpen, setDelegationOpen] = useState(false);
  const [focusedAgentIndex, setFocusedAgentIndex] = useState(0);
  const toggleRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const textareaId = useId();

  const agents = delegationAgents ?? [];
  const executableAgents = agents.filter((agent) => agent.canExecutePlan);
  const canDelegate = executableAgents.length > 0 && Boolean(onApproveWithSubagent);
  const delegationDisabled = Boolean(busy) || !planTrimmed;

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

  // Close the delegation popover when the button can no longer delegate.
  useEffect(() => {
    if (!canDelegate || delegationDisabled) {
      setDelegationOpen(false);
    }
  }, [canDelegate, delegationDisabled]);

  useEffect(() => {
    if (!delegationOpen) {
      return;
    }
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) {
        return;
      }
      if (popoverRef.current?.contains(target) || toggleRef.current?.contains(target)) {
        return;
      }
      setDelegationOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [delegationOpen]);

  useEffect(() => {
    if (!delegationOpen) {
      return;
    }
    // Start on the first agent the user may actually pick.
    const first = agents.findIndex((agent) => agent.canExecutePlan);
    setFocusedAgentIndex(first >= 0 ? first : 0);
    textareaRef.current?.focus();
  }, [delegationOpen]);

  const closeDelegation = () => {
    setDelegationOpen(false);
    toggleRef.current?.focus();
  };

  const submitDelegation = (agent: PlanDelegationAgentOption) => {
    if (delegationDisabled || !agent.canExecutePlan) {
      return;
    }
    const note = additionalMessage?.trim();
    onApproveWithSubagent?.(agent.agentKey, note ? note : undefined);
    setDelegationOpen(false);
  };

  const onPopoverKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeDelegation();
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") {
      return;
    }
    // Let the message textarea keep its own cursor navigation.
    const target = event.target as HTMLElement | null;
    if (!target?.classList.contains("plan-approval-delegation-agent")) {
      return;
    }
    if (agents.length === 0) {
      return;
    }
    // Read-only agents are never selectable, so keyboard focus skips them.
    const selectable = agents.map((agent, index) => (agent.canExecutePlan ? index : -1)).filter((index) => index >= 0);
    if (selectable.length === 0) {
      return;
    }
    event.preventDefault();
    const delta = event.key === "ArrowDown" ? 1 : -1;
    const currentPos = selectable.indexOf(focusedAgentIndex);
    const nextPos = currentPos < 0 ? 0 : (currentPos + delta + selectable.length) % selectable.length;
    const next = selectable[nextPos] ?? 0;
    setFocusedAgentIndex(next);
    const buttons = popoverRef.current?.querySelectorAll<HTMLButtonElement>(
      ".plan-approval-delegation-agent:not([disabled])",
    );
    const position = selectable.indexOf(next);
    buttons?.[position]?.focus();
  };

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
        <div className="plan-approval-execute-split">
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
          {canDelegate ? (
            <button
              ref={toggleRef}
              type="button"
              className={
                docked
                  ? "bash-approval-submit plan-approval-delegate-toggle"
                  : "plan-button primary plan-approval-delegate-toggle"
              }
              onClick={() => setDelegationOpen((current) => !current)}
              disabled={delegationDisabled}
              aria-haspopup="menu"
              aria-expanded={delegationOpen}
              aria-label={t("approval.plan.delegateAria")}
              title={t("approval.plan.delegateAria")}
            >
              <ChevronDown size={14} aria-hidden />
            </button>
          ) : null}
          {canDelegate && delegationOpen ? (
            <div
              ref={popoverRef}
              className="plan-approval-delegation-popover"
              role="menu"
              aria-label={t("approval.plan.delegateTitle")}
              onKeyDown={onPopoverKeyDown}
            >
              <div className="plan-approval-delegation-header">{t("approval.plan.delegateTitle")}</div>
              <label className="plan-approval-delegation-message-label" htmlFor={textareaId}>
                {t("approval.plan.delegateMessageLabel")}
              </label>
              <textarea
                ref={textareaRef}
                id={textareaId}
                className="plan-approval-delegation-message"
                value={additionalMessage ?? ""}
                onChange={(event) => onAdditionalMessageChange?.(event.target.value)}
                placeholder={t("approval.plan.delegateMessagePlaceholder")}
                rows={2}
                disabled={delegationDisabled}
              />
              <ul className="plan-approval-delegation-agents">
                {agents.map((agent, index) => (
                  <li key={agent.agentKey}>
                    <button
                      type="button"
                      role="menuitem"
                      className={[
                        "plan-approval-delegation-agent",
                        index === focusedAgentIndex ? "is-focused" : "",
                        agent.canExecutePlan ? "" : "is-read-only",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      onClick={() => submitDelegation(agent)}
                      disabled={delegationDisabled || !agent.canExecutePlan}
                      title={agent.canExecutePlan ? undefined : t("approval.plan.delegateReadOnly")}
                    >
                      <span className="plan-approval-delegation-agent-name">{agent.displayName}</span>
                      {agent.displayName !== agent.agentKey ? (
                        <span className="plan-approval-delegation-agent-key">{agent.agentKey}</span>
                      ) : null}
                      {agent.canExecutePlan ? null : (
                        <span className="plan-approval-delegation-agent-note">
                          {t("approval.plan.delegateReadOnly")}
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
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
