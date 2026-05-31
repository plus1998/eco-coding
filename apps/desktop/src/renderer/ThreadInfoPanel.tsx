import { DollarSign, Folder, GitBranch, HardDrive, HelpCircle, ListTodo, Package, X } from "lucide-react";
import { useEffect, useState } from "react";
import { formatCostUsd, formatSavingsLine, formatTokenCount, formatUsageBadge } from "@eco/runtime";
import type {
  BillingUsageSource,
  CoderTodoItem,
  ThreadBillingSnapshot,
  ThreadContextSnapshot,
  ThreadStatus,
  WorkspaceInfo,
} from "../shared/ipc";
import { CoderTodoPanel } from "./CoderTodoPanel";
import {
  billingEmptyHint,
  contextCardPlaceholder,
  shouldShowThreadUsagePanels,
} from "../shared/thread-usage-summary";
import { ContextCard } from "./ContextCard";
import { UsageBreakdownPanel } from "./UsageBreakdownPanel";

export interface ThreadUsageSummary {
  billing?: ThreadBillingSnapshot;
  context?: ThreadContextSnapshot;
  contextTokens?: number;
}

interface ThreadInfoPanelProps {
  threadId?: string;
  workspace?: WorkspaceInfo;
  workspacePath?: string;
  gitBranch?: string;
  dirtyFileCount?: number;
  todos: CoderTodoItem[];
  pendingWorktreeApply?: { changedFiles: string[] };
  threadStatus?: ThreadStatus;
  usageSummary?: ThreadUsageSummary;
  onApplyWorktree?: () => void;
  worktreeApplyBusy?: boolean;
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

  return (
    <div className="thread-info-source-compare">
      <h5 className="usage-breakdown-heading">计费校验</h5>
      <ul className="thread-info-billing-list">
        {rows.map((row) => {
          const tokenBadge = formatUsageBadge({
            inputTokens: row.totalTokens.input,
            outputTokens: row.totalTokens.output,
            cacheReadTokens: row.totalTokens.cacheRead,
            cacheCreationTokens: row.totalTokens.cacheCreation,
          });
          const reported =
            row.reportedCostUsd !== undefined ? ` · 报告 ${formatCostUsd(row.reportedCostUsd)}` : "";
          const primary = billing.primarySource === row.source ? " · 主账" : "";
          return (
            <li key={row.source} title={`${billingSourceLabels[row.source]} token × models.dev 单价${reported}`}>
              <span>
                {billingSourceLabels[row.source]}{primary}
                <small> {tokenBadge}</small>
              </span>
              <span>
                {formatCostUsd(row.ecoCostUsd)}
                {row.reportedCostUsd !== undefined ? (
                  <small> / {formatCostUsd(row.reportedCostUsd)}</small>
                ) : null}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function BillingFloatingCard({
  billing,
  threadStatus,
  tokenBadge,
  plannerLabel,
  cacheCostSuffix,
  showBilling,
  onDismiss,
}: {
  billing?: ThreadBillingSnapshot;
  threadStatus?: ThreadStatus;
  tokenBadge: string | null;
  plannerLabel: string;
  cacheCostSuffix: ReturnType<typeof formatCacheCostSuffix>;
  showBilling: boolean;
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
              <span className="thread-info-help-wrap">
                <button
                  type="button"
                  className="thread-info-help"
                  aria-describedby="thread-info-unorchestrated-help-tip"
                  aria-label="未编排说明"
                >
                  <HelpCircle size={12} aria-hidden />
                </button>
                <span id="thread-info-unorchestrated-help-tip" className="thread-info-help-tooltip" role="tooltip">
                  假设全部 token 均按主模型（{plannerLabel}）models.dev 单价估算，未做角色编排
                </span>
              </span>
            </span>
            <span>{formatCostUsd(billing.plannerTokenCostUsd)}</span>
          </li>
          <li className="thread-info-billing-eco">
            <span className="thread-info-billing-row-label">
              <span>② 经济编程</span>
              <span className="thread-info-help-wrap">
                <button
                  type="button"
                  className="thread-info-help"
                  aria-describedby="thread-info-eco-help-tip"
                  aria-label="经济编程说明"
                >
                  <HelpCircle size={12} aria-hidden />
                </button>
                <span id="thread-info-eco-help-tip" className="thread-info-help-tooltip" role="tooltip">
                  Eco-Coding通过前沿模型做计划、拆分任务、审查，经济模型进行执行任务、测试等编排方案进行Token的节约
                </span>
              </span>
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

      {showBilling && billing && !billing.pricingResolved ? (
        <p className="thread-info-billing-warning">部分模型未匹配 models.dev 单价，①② 可能不完整。</p>
      ) : null}

      {showBilling && billing ? <BillingSourceRows billing={billing} /> : null}
      {showBilling && billing ? <UsageBreakdownPanel billing={billing} variant="full" /> : null}
    </div>
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
}) {
  const [billingOpen, setBillingOpen] = useState(true);
  const [contextOpen, setContextOpen] = useState(true);

  useEffect(() => {
    setBillingOpen(true);
    setContextOpen(true);
  }, [threadId]);

  const showBillingFloat = showBillingSection;
  const showContextFloat = true;

  if (!showBillingFloat && !showContextFloat) {
    return null;
  }

  return (
    <div className="thread-info-float-stack">
      <div className="thread-info-float-pills">
        {showBillingFloat && !billingOpen ? (
          <button
            type="button"
            className="thread-info-float-reopen"
            onClick={() => setBillingOpen(true)}
            aria-label="显示计费对比"
          >
            计费
          </button>
        ) : null}
        {showContextFloat && !contextOpen ? (
          <button
            type="button"
            className="thread-info-float-reopen"
            onClick={() => setContextOpen(true)}
            aria-label="显示 Context"
          >
            Context
          </button>
        ) : null}
      </div>

      {showBillingFloat && billingOpen ? (
        <div className="thread-info-float-panel">
          <BillingFloatingCard
            {...(billing !== undefined && { billing })}
            {...(threadStatus !== undefined && { threadStatus })}
            tokenBadge={tokenBadge}
            plannerLabel={plannerLabel}
            cacheCostSuffix={cacheCostSuffix}
            showBilling={showBilling}
            onDismiss={() => setBillingOpen(false)}
          />
        </div>
      ) : null}

      {showContextFloat && contextOpen ? (
        <div className="thread-info-float-panel">
          <ContextCard
            {...(context !== undefined && { context })}
            placeholder={contextPlaceholder}
            showWhenEmpty
            onDismiss={() => setContextOpen(false)}
          />
        </div>
      ) : null}
    </div>
  );
}

export function ThreadInfoPanel({
  threadId,
  workspace,
  workspacePath,
  gitBranch,
  dirtyFileCount,
  todos,
  pendingWorktreeApply,
  threadStatus,
  usageSummary,
  onApplyWorktree,
  worktreeApplyBusy,
}: ThreadInfoPanelProps) {
  const projectLabel = workspacePath?.split("/").filter(Boolean).pop() ?? workspace?.name ?? "未打开项目";
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
  const showProgress =
    todos.length > 0 ||
    threadStatus === "running" ||
    threadStatus === "queued" ||
    (pendingWorktreeApply?.changedFiles.length ?? 0) > 0;

  return (
    <aside className="thread-info-panel" aria-label="会话信息">
      <div className="thread-info-panel-scroll">
        <section className="thread-info-section">
          <h3 className="thread-info-heading">工作区</h3>
          <ul className="thread-info-list">
            <li>
              <Folder size={14} aria-hidden />
              <span className="thread-info-value" title={workspacePath}>
                {projectLabel}
              </span>
            </li>
            {workspace === undefined ? (
              <li className="thread-info-muted">正在检测 Git…</li>
            ) : workspace.isGitRepository ? (
              <li>
                <GitBranch size={14} aria-hidden />
                <span className="thread-info-value">
                  {gitBranch ?? workspace.branch ?? "detached"}
                  {typeof dirtyFileCount === "number" && dirtyFileCount > 0
                    ? ` · ${dirtyFileCount} 处未提交`
                    : ""}
                </span>
              </li>
            ) : (
              <li className="thread-info-muted">非 Git 仓库</li>
            )}
            {threadStatus ? (
              <li>
                <Package size={14} aria-hidden />
                <span className="thread-info-value">状态：{threadStatus}</span>
              </li>
            ) : null}
          </ul>
        </section>

        {showProgress ? (
          <section className="thread-info-section thread-info-todos">
            <h3 className="thread-info-heading">
              <ListTodo size={14} aria-hidden />
              进度
            </h3>
            {pendingWorktreeApply && pendingWorktreeApply.changedFiles.length > 0 ? (
              <div className="thread-info-worktree-embed">
                <p className="thread-info-worktree-embed-title">待合并 {pendingWorktreeApply.changedFiles.length} 个文件</p>
                <ul className="thread-info-file-list">
                  {pendingWorktreeApply.changedFiles.map((file) => (
                    <li key={file}>
                      <code>{file}</code>
                    </li>
                  ))}
                </ul>
                {onApplyWorktree ? (
                  <button
                    type="button"
                    className="plan-button primary thread-info-apply"
                    onClick={onApplyWorktree}
                    disabled={worktreeApplyBusy}
                  >
                    {worktreeApplyBusy ? "正在合并…" : "应用到工作区"}
                  </button>
                ) : null}
              </div>
            ) : null}
            {todos.length > 0 ? (
              <CoderTodoPanel todos={todos} embedded compact />
            ) : (
              <p className="thread-info-muted thread-info-todos-empty">等待 Planner 通过 SDK Task 工具更新进度…</p>
            )}
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
        />
      ) : null}
    </aside>
  );
}
