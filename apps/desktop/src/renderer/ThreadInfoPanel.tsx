import { DollarSign, Folder, GitBranch, HardDrive, HelpCircle, ListTodo, Package } from "lucide-react";
import { formatCostUsd, formatSavingsLine, formatTokenCount, formatUsageBadge } from "@eco/runtime";
import type {
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

export interface ThreadUsageSummary {
  billing?: ThreadBillingSnapshot;
  context?: ThreadContextSnapshot;
  contextTokens?: number;
}

interface ThreadInfoPanelProps {
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

export function ThreadInfoPanel({
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

  return (
    <aside className="thread-info-panel" aria-label="会话信息">
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
        {showUsagePanels ? (
          <ContextCard
            context={usageSummary?.context}
            placeholder={contextCardPlaceholder(threadStatus)}
            showWhenEmpty
          />
        ) : null}
      </section>

      {showBillingSection ? (
        <section className="thread-info-section thread-info-billing">
          <h3 className="thread-info-heading">
            计费对比
            <span
              className="thread-info-help"
              title="① OTel cost_usd 累计（Claude Code 内置价目，含缓存折扣）② OTel token × 主模型 models.dev 单价 ③ OTel token × 各 role 实际 models.dev 单价（input/output/cache 分项）节省 = ②−③"
            >
              <HelpCircle size={13} aria-hidden />
            </span>
          </h3>
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
          {showBilling ? (
            <ul className="thread-info-billing-list">
              <li title="Claude Code 内置价目估算，非权威账单">
                <span>① SDK（OTel）</span>
                <span>{formatCostUsd(billing.otelCostUsd)}</span>
              </li>
              <li title={`OTel token × Planner models.dev 单价（${plannerLabel}）`}>
                <span>② 全主模型（{plannerLabel}）</span>
                <span>{formatCostUsd(billing.plannerTokenCostUsd)}</span>
              </li>
              <li
                className="thread-info-billing-eco"
                title="OTel token × 各 role 实际 models.dev 单价（含 cache_read/cache_write 分项）"
              >
                <span>③ 经济编程</span>
                <strong>{formatCostUsd(billing.ecoCostUsd)}</strong>
              </li>
              <li
                className={
                  billing.savedUsd >= 0 ? "thread-info-billing-saved" : "thread-info-billing-over"
                }
                title="② − ③"
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
          {showBilling && !billing.pricingResolved ? (
            <p className="thread-info-billing-warning">部分模型未匹配 models.dev 单价，②③ 可能不完整。</p>
          ) : null}
        </section>
      ) : null}

      {pendingWorktreeApply && pendingWorktreeApply.changedFiles.length > 0 ? (
        <section className="thread-info-section">
          <h3 className="thread-info-heading">文件改动</h3>
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
        </section>
      ) : null}

      {todos.length > 0 || threadStatus === "running" || threadStatus === "queued" ? (
        <section className="thread-info-section thread-info-todos">
          <h3 className="thread-info-heading">
            <ListTodo size={14} aria-hidden />
            进度
          </h3>
          {todos.length > 0 ? (
            <CoderTodoPanel todos={todos} embedded compact />
          ) : (
            <p className="thread-info-muted thread-info-todos-empty">等待 Planner 通过 SDK Task 工具更新进度…</p>
          )}
        </section>
      ) : null}
    </aside>
  );
}
