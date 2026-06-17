import { AlertTriangle, DollarSign, HardDrive, ListTodo, X } from "lucide-react";
import { ThreadInfoHelpButton } from "./ThreadInfoHelpButton";
import {
  type CSSProperties,
  type FocusEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { composerFloatingStyleForAnchor } from "./composer-floating";
import { formatCostUsd, formatSavingsLine, formatTokenCount, formatUsageBadge } from "@eco/runtime";
import type {
  BillingUsageSource,
  CoderTodoItem,
  ThreadBillingSnapshot,
  ThreadContextSnapshot,
  ThreadStatus,
  WorkspaceInfo,
} from "../shared/ipc";
import { collectBillingOpenBoundaryNotes } from "../shared/billing-open-boundaries";
import { filterVisibleBillingDiagnostics } from "../shared/billing-diagnostics-visibility";
import { CoderTodoPanel } from "./CoderTodoPanel";
import {
  billingEmptyHint,
  contextCardPlaceholder,
  shouldShowThreadUsagePanels,
} from "../shared/thread-usage-summary";
import { ContextCard } from "./ContextCard";
import { UsageBreakdownPanel, ExpandableBillingSection } from "./UsageBreakdownPanel";
import type { RuntimeAgentDisplayNames } from "./runtime-agent-display";
import { WorkspaceGitSection } from "./WorkspaceGitSection";
import { WorkspaceGitCommitGraph } from "./WorkspaceGitCommitGraph";
import type {
  GitSettingsSnapshot,
  GitWorkingTreeStatus,
  RoutePricingHint,
  RuntimeAgentRole,
  RuntimeRoleRouteConfig,
  SubagentEnabledSettings,
  WorkspaceDiffResult,
} from "../shared/ipc";
import type { ComposerAgentModelLabel } from "./composer-agent-model-labels";

export interface ThreadUsageSummary {
  billing?: ThreadBillingSnapshot;
  context?: ThreadContextSnapshot;
  contextTokens?: number;
}

interface ThreadInfoPanelProps {
  threadId?: string;
  workspace?: WorkspaceInfo;
  workspacePath?: string;
  workspaceLabel?: string;
  gitStatus?: GitWorkingTreeStatus;
  gitBusy?: boolean;
  commitDisabled?: boolean;
  profileId?: string;
  agentModelLabels?: ComposerAgentModelLabel[];
  routes?: readonly RuntimeRoleRouteConfig[];
  routePricingHints?: RoutePricingHint[];
  subagentEnabled?: SubagentEnabledSettings;
  gitSettings?: GitSettingsSnapshot;
  onCheckoutGitBranch?: (branch: string) => void | Promise<void>;
  onCreateGitBranch?: (branch: string) => void | Promise<void>;
  onOpenGitSettings?: () => void;
  onSaveCommitRolePreference?: (role: RuntimeAgentRole | "auto") => void | Promise<void>;
  onCommitSuccess?: () => void | Promise<void>;
  onChangesDiffLoaded?: (diff: WorkspaceDiffResult) => void | Promise<void>;
  onPullSuccess?: () => void | Promise<void>;
  onResolveConflictsWithAgent?: (conflictFiles: string[]) => void | Promise<void>;
  scriptsDisabled?: boolean;
  onOpenScriptsDialog?: () => void;
  todos?: CoderTodoItem[];
  threadStatus?: ThreadStatus;
  usageSummary?: ThreadUsageSummary;
  agentDisplayNames?: RuntimeAgentDisplayNames;
}

function formatCacheCostSuffix(billing: ThreadBillingSnapshot): {
  label: string;
  title: string;
} | null {
  const breakdown = billing.ecoCostBreakdown;
  const cacheRead = billing.totalTokens.cacheRead;
  const cacheCreation = billing.totalTokens.cacheCreation;
  if (!breakdown || (cacheRead <= 0 && cacheCreation <= 0)) {
    return null;
  }
  const cacheUsd = breakdown.cacheReadUsd + breakdown.cacheCreationUsd;
  const cachePct = billing.ecoCostUsd > 0 ? (cacheUsd / billing.ecoCostUsd) * 100 : 0;
  const detail: string[] = [];
  if (cacheRead > 0) {
    detail.push(`读 ${formatTokenCount(cacheRead)}`);
  }
  if (cacheCreation > 0) {
    detail.push(`写 ${formatTokenCount(cacheCreation)}`);
  }
  return {
    label: `${formatCostUsd(cacheUsd)}（${cachePct.toFixed(0)}%）`,
    title: `缓存费用（models.dev cache_read / cache_write）${detail.join(" · ")}`,
  };
}

function hasBillingData(billing?: ThreadBillingSnapshot): billing is ThreadBillingSnapshot {
  if (!billing) {
    return false;
  }
  const total =
    billing.totalTokens.input +
    billing.totalTokens.output +
    billing.totalTokens.cacheRead +
    billing.totalTokens.cacheCreation;
  return (
    total > 0 ||
    billing.otelCostUsd > 0 ||
    billing.plannerTokenCostUsd > 0 ||
    billing.ecoCostUsd > 0
  );
}

const billingSourceLabels: Record<BillingUsageSource, string> = {
  proxy: "Proxy",
  otel: "OTel",
  sdk: "SDK",
};

function visibleBillingDiagnostics(
  billing: ThreadBillingSnapshot,
  threadStatus?: ThreadStatus,
): ReturnType<typeof filterVisibleBillingDiagnostics> {
  const diagnostics = filterVisibleBillingDiagnostics(billing.diagnostics, threadStatus);
  if (diagnostics.length > 0) {
    return diagnostics;
  }
  if (!billing.pricingResolved) {
    return [
      {
        type: "pricing_unresolved",
        severity: "warning",
        message: "部分模型未匹配 models.dev 单价，①② 可能不完整。",
      },
    ];
  }
  return [];
}

function BillingDiagnostics({
  billing,
  threadStatus,
}: {
  billing: ThreadBillingSnapshot;
  threadStatus: ThreadStatus | undefined;
}) {
  const diagnostics = visibleBillingDiagnostics(billing, threadStatus);
  const openBoundaries = collectBillingOpenBoundaryNotes(billing);
  if (diagnostics.length === 0 && openBoundaries.length === 0) {
    return null;
  }
  const highestSeverity = diagnostics.some((diagnostic) => diagnostic.severity === "error")
    ? "error"
    : diagnostics.length > 0
      ? "warning"
      : "info";
  return (
    <div className={`thread-info-billing-diagnostics ${highestSeverity}`} role="status">
      <AlertTriangle size={13} aria-hidden />
      <ul>
        {diagnostics.slice(0, 4).map((diagnostic, index) => (
          <li key={`${diagnostic.type}-${diagnostic.field ?? ""}-${diagnostic.agentId ?? ""}-${index}`}>
            {diagnostic.message}
          </li>
        ))}
        {openBoundaries.map((note) => (
          <li key={note.id} className="thread-info-billing-open-boundary">
            <span className="thread-info-billing-boundary-id">{note.id}</span> {note.message}
          </li>
        ))}
      </ul>
    </div>
  );
}

function BillingSourceRows({ billing }: { billing: ThreadBillingSnapshot }) {
  const sources = billing.sourceBreakdown;
  if (!sources) {
    return null;
  }
  const rows = (["proxy", "otel", "sdk"] as BillingUsageSource[])
    .map((source) => sources[source])
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
  if (rows.length === 0) {
    return null;
  }

  const summary = rows.map((row) => billingSourceLabels[row.source]).join(" · ");

  return (
    <ExpandableBillingSection title="计费校验" summary={summary} className="thread-info-source-compare">
      <ul className="thread-info-source-list">
        {rows.map((row) => {
          const tokenBadge = formatUsageBadge({
            inputTokens: row.totalTokens.input,
            outputTokens: row.totalTokens.output,
            cacheReadTokens: row.totalTokens.cacheRead,
            cacheCreationTokens: row.totalTokens.cacheCreation,
          });
          const isPrimary = billing.primarySource === row.source;
          const isDisplay =
            (billing.displaySource ?? billing.primarySource) === row.source &&
            billing.displaySource !== billing.primarySource;
          return (
            <li
              key={row.source}
              className="thread-info-source-row"
              title={`${billingSourceLabels[row.source]} token × models.dev 单价${
                row.reportedCostUsd !== undefined ? ` · 报告 ${formatCostUsd(row.reportedCostUsd)}` : ""
              }`}
            >
              <div className="thread-info-source-row-head">
                <span className="thread-info-source-label">
                  {billingSourceLabels[row.source]}
                  {isPrimary ? <span className="thread-info-source-primary">主账</span> : null}
                  {isDisplay ? <span className="thread-info-source-display">展示中</span> : null}
                </span>
                <span className="thread-info-source-cost">
                  {formatCostUsd(row.ecoCostUsd)}
                  {row.reportedCostUsd !== undefined ? (
                    <span className="thread-info-source-reported"> / {formatCostUsd(row.reportedCostUsd)}</span>
                  ) : null}
                </span>
              </div>
              <span className="thread-info-source-tokens" title="↑ 输入 ↓ 输出 ⊙ 缓存">
                {tokenBadge}
              </span>
            </li>
          );
        })}
      </ul>
    </ExpandableBillingSection>
  );
}

function formatBillingPillCost(billing?: ThreadBillingSnapshot): string {
  const cost = billing?.ecoCostUsd ?? 0;
  if (cost <= 0) {
    return "$0";
  }
  return formatCostUsd(cost);
}

function resolvePlannerOccupancyPct(context?: ThreadContextSnapshot): number | undefined {
  if (!context) {
    return undefined;
  }
  const planner = context.roles?.find((role) => role.role === "planner");
  return planner?.occupancyPct ?? context.occupancyPct;
}

function contextRingStroke(pct: number): string {
  if (pct >= 95) {
    return "#f87171";
  }
  if (pct >= 85) {
    return "#fbbf24";
  }
  return "#60a5fa";
}

function ContextOccupancyRing({
  pct,
  size = 14,
  strokeWidth = 2,
}: {
  pct?: number | undefined;
  size?: number;
  strokeWidth?: number;
}) {
  const radius = (size - strokeWidth) / 2;
  const center = size / 2;
  const circumference = 2 * Math.PI * radius;
  const clampedPct = Math.max(0, Math.min(100, pct ?? 0));
  const offset = circumference * (1 - clampedPct / 100);

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className="thread-info-context-ring"
      aria-hidden
    >
      <circle
        cx={center}
        cy={center}
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
      />
      {clampedPct > 0 ? (
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke={contextRingStroke(clampedPct)}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform={`rotate(-90 ${center} ${center})`}
        />
      ) : null}
    </svg>
  );
}

function BillingFloatPillLabel({ billing }: { billing?: ThreadBillingSnapshot }) {
  const cost = billing?.ecoCostUsd ?? 0;
  return (
    <span className="thread-info-float-pill-label">
      <span>计费</span>
      <span className={cost > 0 ? "thread-info-float-pill-cost" : "thread-info-float-pill-cost is-empty"}>
        {formatBillingPillCost(billing)}
      </span>
    </span>
  );
}

function ContextFloatPillLabel({ context }: { context?: ThreadContextSnapshot }) {
  const occupancyPct = resolvePlannerOccupancyPct(context);
  return (
    <span className="thread-info-float-pill-label">
      <ContextOccupancyRing pct={occupancyPct} />
      <span>Context</span>
    </span>
  );
}

function BillingFloatingCard({
  billing,
  threadId,
  threadStatus,
  tokenBadge,
  plannerLabel,
  cacheCostSuffix,
  showBilling,
  agentDisplayNames,
  onDismiss,
}: {
  billing?: ThreadBillingSnapshot;
  threadId?: string;
  threadStatus?: ThreadStatus;
  tokenBadge: string | null;
  plannerLabel: string;
  cacheCostSuffix: ReturnType<typeof formatCacheCostSuffix>;
  showBilling: boolean;
  agentDisplayNames?: RuntimeAgentDisplayNames;
  onDismiss: () => void;
}) {
  return (
    <div className="thread-info-float-card thread-info-billing-card">
      <div className="thread-info-float-card-header">
        <h4 className="thread-info-float-card-title">
          计费对比
        </h4>
        <button type="button" className="thread-info-float-dismiss" onClick={onDismiss} aria-label="关闭计费对比">
          <X size={14} aria-hidden />
        </button>
      </div>

      {showBilling && tokenBadge ? (
        <p
          className="thread-info-billing-tokens"
          title="↑ 输入 ↓ 输出 ⊙ 缓存 token（读+写合计）；线程累计，非单次请求"
        >
          {tokenBadge}
          {cacheCostSuffix ? (
            <>
              {" · "}
              <HardDrive size={12} className="thread-info-cache-icon" aria-hidden />
              <span title={cacheCostSuffix.title}>{cacheCostSuffix.label}</span>
            </>
          ) : null}
        </p>
      ) : null}

      {showBilling && billing ? (
        <ul className="thread-info-billing-list">
          <li>
            <span className="thread-info-billing-row-label">
              <span>① 未编排</span>
              <ThreadInfoHelpButton label="未编排说明">
                假设全部 token 均按主模型（{plannerLabel}）models.dev 单价估算，未做角色编排
              </ThreadInfoHelpButton>
            </span>
            <span>{formatCostUsd(billing.plannerTokenCostUsd)}</span>
          </li>
          <li className="thread-info-billing-eco">
            <span className="thread-info-billing-row-label">
              <span>② 经济编程</span>
              <ThreadInfoHelpButton label="经济编程说明">
                Eco-Coding通过前沿模型做计划、拆分任务、审查，经济模型进行执行任务、测试等编排方案进行Token的节约
              </ThreadInfoHelpButton>
            </span>
            <strong>{formatCostUsd(billing.ecoCostUsd)}</strong>
          </li>
          <li
            className={billing.savedUsd >= 0 ? "thread-info-billing-saved" : "thread-info-billing-over"}
            title="① − ②"
          >
            <span>
              <DollarSign size={13} aria-hidden />
              {formatSavingsLine(billing.savedUsd, billing.savedPct).replace(/^eco-coding /, "")}
            </span>
          </li>
        </ul>
      ) : (
        <p className="thread-info-muted thread-info-billing-empty">{billingEmptyHint(threadStatus)}</p>
      )}

      {showBilling && billing ? <BillingDiagnostics billing={billing} threadStatus={threadStatus} /> : null}

      {showBilling && billing ? (
        <UsageBreakdownPanel
          billing={billing}
          variant="full"
          {...(threadId !== undefined && { threadId })}
          {...(agentDisplayNames && { agentDisplayNames })}
        />
      ) : null}
      {showBilling && billing ? <BillingSourceRows billing={billing} /> : null}
    </div>
  );
}

function ThreadInfoFloatControl({
  label,
  ariaLabel,
  resetKey,
  width = 320,
  minHeight = 200,
  children,
}: {
  label: ReactNode;
  ariaLabel: string;
  resetKey?: string | undefined;
  width?: number;
  minHeight?: number;
  children: (closePanel: () => void) => ReactNode;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [hovered, setHovered] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [panelStyle, setPanelStyle] = useState<CSSProperties>(() => ({ visibility: "hidden" }));
  const open = hovered || pinned;

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
        width,
        minHeight,
        prefer: "above",
        align: "start",
      }),
    );
  }, [minHeight, width]);

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
    clearCloseTimer();
    setHovered(false);
    setPinned(false);
  }, [clearCloseTimer, resetKey]);

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
        className="thread-info-float-popover"
        role="dialog"
        aria-label={ariaLabel}
        style={panelStyle}
        onMouseEnter={showPanel}
        onMouseLeave={scheduleClose}
        onFocus={showPanel}
        onBlur={handleBlur}
      >
        <div className="thread-info-float-popover-body">{children(closePanel)}</div>
      </div>,
      document.body,
    );

  return (
    <span className="thread-info-float-control">
      <button
        ref={triggerRef}
        type="button"
        className={
          open
            ? "thread-info-float-reopen is-clickable is-active"
            : "thread-info-float-reopen is-clickable"
        }
        aria-label={ariaLabel}
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
        {label}
      </button>
      {popover}
    </span>
  );
}

function ThreadInfoFloatStack({
  threadId,
  showBillingSection,
  billing,
  threadStatus,
  tokenBadge,
  plannerLabel,
  cacheCostSuffix,
  showBilling,
  context,
  contextPlaceholder,
  agentDisplayNames,
}: {
  threadId?: string;
  showBillingSection: boolean;
  billing?: ThreadBillingSnapshot;
  threadStatus?: ThreadStatus;
  tokenBadge: string | null;
  plannerLabel: string;
  cacheCostSuffix: ReturnType<typeof formatCacheCostSuffix>;
  showBilling: boolean;
  context?: ThreadContextSnapshot;
  contextPlaceholder: string;
  agentDisplayNames?: RuntimeAgentDisplayNames;
}) {
  const showBillingFloat = showBillingSection;
  const showContextFloat = true;
  const contextOccupancyPct = resolvePlannerOccupancyPct(context);

  if (!showBillingFloat && !showContextFloat) {
    return null;
  }

  return (
    <div className="thread-info-float-stack">
      <div className="thread-info-float-pills">
        {showBillingFloat ? (
          <ThreadInfoFloatControl
            label={<BillingFloatPillLabel {...(billing !== undefined && { billing })} />}
            ariaLabel={`计费对比，当前 ${formatBillingPillCost(billing)}`}
            resetKey={threadId}
            width={320}
            minHeight={220}
          >
            {(closePanel) => (
              <BillingFloatingCard
                {...(billing !== undefined && { billing })}
                {...(threadId !== undefined && { threadId })}
                {...(threadStatus !== undefined && { threadStatus })}
                tokenBadge={tokenBadge}
                plannerLabel={plannerLabel}
                cacheCostSuffix={cacheCostSuffix}
                showBilling={showBilling}
                {...(agentDisplayNames && { agentDisplayNames })}
                onDismiss={closePanel}
              />
            )}
          </ThreadInfoFloatControl>
        ) : null}
        {showContextFloat ? (
          <ThreadInfoFloatControl
            label={<ContextFloatPillLabel {...(context !== undefined && { context })} />}
            ariaLabel={
              contextOccupancyPct !== undefined
                ? `Context，主 Agent 占用 ${contextOccupancyPct}%`
                : "Context"
            }
            resetKey={threadId}
            width={320}
            minHeight={200}
          >
            {(closePanel) => (
              <ContextCard
                {...(context !== undefined && { context })}
                placeholder={contextPlaceholder}
                showWhenEmpty
                {...(agentDisplayNames && { agentDisplayNames })}
                onDismiss={closePanel}
              />
            )}
          </ThreadInfoFloatControl>
        ) : null}
      </div>
    </div>
  );
}

function hasProgressInfo(todos: CoderTodoItem[]): boolean {
  return todos.some(
    (todo) => todo.status === "pending" || todo.status === "running" || todo.status === "blocked",
  );
}

export function ThreadInfoPanel({
  threadId,
  workspace,
  workspacePath,
  workspaceLabel,
  gitStatus,
  gitBusy,
  commitDisabled,
  profileId,
  agentModelLabels,
  routes,
  routePricingHints,
  subagentEnabled,
  gitSettings,
  onCheckoutGitBranch,
  onCreateGitBranch,
  onOpenGitSettings,
  onSaveCommitRolePreference,
  onCommitSuccess,
  onChangesDiffLoaded,
  onPullSuccess,
  onResolveConflictsWithAgent,
  scriptsDisabled,
  onOpenScriptsDialog,
  todos = [],
  threadStatus,
  usageSummary,
  agentDisplayNames,
}: ThreadInfoPanelProps) {
  const projectLabel =
    workspaceLabel?.trim() ||
    workspacePath?.split("/").filter(Boolean).pop() ||
    workspace?.name ||
    "未打开项目";
  const billing = usageSummary?.billing;
  const tokenBadge = billing
    ? formatUsageBadge({
        inputTokens: billing.totalTokens.input,
        outputTokens: billing.totalTokens.output,
        cacheReadTokens: billing.totalTokens.cacheRead,
        cacheCreationTokens: billing.totalTokens.cacheCreation,
      })
    : null;
  const plannerLabel = billing?.plannerModelLabel?.split(" · ")[0] ?? "主模型";
  const cacheCostSuffix = billing ? formatCacheCostSuffix(billing) : null;
  const showUsagePanels = shouldShowThreadUsagePanels(threadStatus);
  const showBilling = hasBillingData(billing);
  const showBillingSection = showUsagePanels && (showBilling || threadStatus !== undefined);
  const showProgress = hasProgressInfo(todos);
  const [commitsRefreshKey, setCommitsRefreshKey] = useState(0);
  const showCommitGraph = Boolean(
    workspacePath && gitStatus?.isGitRepository && gitStatus.hasGitCommits,
  );

  async function handleCommitSuccess() {
    setCommitsRefreshKey((current) => current + 1);
    await onCommitSuccess?.();
  }

  async function handlePullSuccess() {
    setCommitsRefreshKey((current) => current + 1);
    await onPullSuccess?.();
  }

  return (
    <aside
      id="thread-info-panel"
      className="thread-info-panel"
      aria-label={threadId ? "会话信息" : "工作区"}
    >
      <div
        className={
          showUsagePanels
            ? "thread-info-panel-scroll thread-info-panel-scroll-with-float"
            : "thread-info-panel-scroll"
        }
      >
        <section className="thread-info-section thread-info-workspace-section">
          <h3 className="thread-info-heading">工作区</h3>
          <WorkspaceGitSection
            {...(workspacePath && { workspacePath })}
            workspaceLabel={projectLabel}
            {...(gitStatus && { gitStatus })}
            {...(gitBusy !== undefined && { gitBusy })}
            {...(commitDisabled !== undefined && { commitDisabled })}
            {...(profileId && { profileId })}
            {...(agentModelLabels && { agentModelLabels })}
            {...(routes && { routes })}
            {...(routePricingHints && { routePricingHints })}
            {...(subagentEnabled && { subagentEnabled })}
            {...(gitSettings && { gitSettings })}
            {...(onCheckoutGitBranch && { onCheckoutGitBranch })}
            {...(onCreateGitBranch && { onCreateGitBranch })}
            {...(onOpenGitSettings && { onOpenGitSettings })}
            {...(onSaveCommitRolePreference && { onSaveCommitRolePreference })}
            onCommitSuccess={() => void handleCommitSuccess()}
            {...(onChangesDiffLoaded && { onChangesDiffLoaded })}
            onPullSuccess={() => void handlePullSuccess()}
            {...(onResolveConflictsWithAgent && { onResolveConflictsWithAgent })}
            {...(scriptsDisabled !== undefined && { scriptsDisabled })}
            {...(onOpenScriptsDialog && { onOpenScriptsDialog })}
          />
        </section>

        {showProgress ? (
          <section className="thread-info-section thread-info-todos">
            <h3 className="thread-info-heading">
              <ListTodo size={14} aria-hidden />
              进度
            </h3>
            {todos.length > 0 ? <CoderTodoPanel todos={todos} embedded compact /> : null}
          </section>
        ) : null}
      </div>

      {showUsagePanels ? (
        <ThreadInfoFloatStack
          {...(threadId !== undefined && { threadId })}
          showBillingSection={showBillingSection}
          {...(billing !== undefined && { billing })}
          {...(threadStatus !== undefined && { threadStatus })}
          tokenBadge={tokenBadge}
          plannerLabel={plannerLabel}
          cacheCostSuffix={cacheCostSuffix}
          showBilling={showBilling}
          {...(usageSummary?.context !== undefined && { context: usageSummary.context })}
          contextPlaceholder={contextCardPlaceholder(threadStatus)}
          {...(agentDisplayNames && { agentDisplayNames })}
        />
      ) : null}

      {showCommitGraph ? (
        <div className="thread-info-git-graph-footer">
          <WorkspaceGitCommitGraph
            workspacePath={workspacePath!}
            refreshToken={`${commitsRefreshKey}:${gitStatus?.branch ?? ""}`}
          />
        </div>
      ) : null}
    </aside>
  );
}
