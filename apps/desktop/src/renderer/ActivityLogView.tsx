import { Bot, ChevronDown, Copy, FileSearch, Pencil, RefreshCw, Reply, Search, Terminal } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type {
  ThreadActivityLine,
  ThreadContextSnapshot,
  ThreadSummary,
  ThreadUsageSnapshot,
} from "../shared/ipc";
import { formatRoleModelLabel, formatTokenCount, formatUsageBadge, shortenModelId } from "@eco/runtime";
import { formatDurationMs } from "./AppMessage";
import { isGenericMissionSummary } from "@eco/runtime";
import {
  buildActivityLogBlocks,
  formatDuration,
  type ActivityActionIcon,
  type ActivityDetailBlock,
  type ActivityLogBlock,
} from "./activity-log";
import { MarkdownContent } from "./MarkdownContent";
import { useStreamRequestTiming } from "./useStreamRequestTiming";

const SUBAGENT_ROLE_SHORT: Record<string, string> = {
  explore: "探索",
  architect: "架构",
  coder: "编码",
  reviewer: "审查",
  tester: "测试",
};

const SUBAGENT_ROLES = new Set(Object.keys(SUBAGENT_ROLE_SHORT));

function isSubagentDisplayRole(role?: string): boolean {
  return Boolean(role && SUBAGENT_ROLES.has(role));
}

function shouldOmitSubagentIdentity(
  block: ActivityDetailBlock,
  hideSubagentIdentity?: boolean,
): boolean {
  if (!hideSubagentIdentity) {
    return false;
  }
  if (block.kind === "model-request") {
    return isSubagentDisplayRole(block.role);
  }
  if (block.kind === "phase" || block.kind === "thinking") {
    return false;
  }
  if ("subagent" in block && block.subagent) {
    return isSubagentDisplayRole(block.subagent);
  }
  return false;
}

function extractSubagentRolesFromChildren(children: readonly ActivityDetailBlock[]): string[] {
  const roles = new Set<string>();
  for (const child of children) {
    if (child.kind === "subagent-mission") {
      roles.add(child.subagent);
      continue;
    }
    if (
      (child.kind === "action" ||
        child.kind === "narrative" ||
        child.kind === "tool-failed" ||
        child.kind === "agent-request") &&
      child.subagent
    ) {
      roles.add(child.subagent);
    }
  }
  return [...roles];
}

function buildSubagentChips(
  roles: readonly string[],
  modelByRole?: Record<string, string>,
): Array<{ role: string; label: string }> {
  const counts = new Map<string, number>();
  for (const role of roles) {
    counts.set(role, (counts.get(role) ?? 0) + 1);
  }
  return [...counts.entries()].map(([role, count]) => {
    const full = formatRoleModelLabel(role, modelByRole?.[role]);
    const short = SUBAGENT_ROLE_SHORT[role] ?? full.split(" · ")[0] ?? full;
    return {
      role,
      label: count > 1 ? `${short} ×${count}` : short,
    };
  });
}

type SubagentMetaEntry = {
  role: string;
  modelShort?: string;
  contextText?: string;
};

function formatContextCapacityText(occupied: number, limit?: number): string | undefined {
  if (limit !== undefined && limit > 0) {
    return `${formatTokenCount(occupied)} / ${formatTokenCount(limit)}`;
  }
  if (occupied > 0) {
    return formatTokenCount(occupied);
  }
  return undefined;
}

function buildSubagentMetaEntries(
  roles: readonly string[],
  modelByRole?: Record<string, string>,
  usageByRole?: Record<string, ThreadUsageSnapshot>,
  context?: ThreadContextSnapshot,
): SubagentMetaEntry[] {
  const uniqueRoles = [...new Set(roles)];
  return uniqueRoles.map((role) => {
    const roleContext = context?.roles?.find((entry) => entry.role === role);
    const usage = usageByRole?.[role];
    const modelId = roleContext?.modelId ?? usage?.modelId ?? modelByRole?.[role];
    const occupied = roleContext?.occupied ?? usage?.contextTokens ?? 0;
    const limit = roleContext?.limit ?? usage?.contextLimit;
    const contextText = formatContextCapacityText(occupied, limit);
    const modelShort = modelId?.trim() ? shortenModelId(modelId.trim()) : undefined;
    return {
      role,
      ...(modelShort && { modelShort }),
      ...(contextText && { contextText }),
    };
  });
}

interface ActivityLogViewProps {
  lines: ThreadActivityLine[];
  thread?: ThreadSummary;
  onRestorePrompt?: (prompt: string) => void;
  modelByRole?: Record<string, string>;
  usageByRole?: Record<string, ThreadUsageSnapshot>;
  context?: ThreadContextSnapshot;
  /** Called when planner / main-window log content changes — scroll the activity feed. */
  onPlannerLayoutChange?: () => void;
}

export function ActivityLogView({
  lines,
  thread,
  onRestorePrompt,
  modelByRole,
  usageByRole,
  context,
  onPlannerLayoutChange,
}: ActivityLogViewProps) {
  const effectiveLines = useMemo(() => {
    if (lines.some((line) => line.role === "user") || !thread?.prompt.trim()) {
      return lines;
    }
    return [{ id: `legacy-${thread.id}`, role: "user", message: thread.prompt }, ...lines];
  }, [lines, thread?.id, thread?.prompt]);

  const blocks = useMemo(
    () =>
      buildActivityLogBlocks(effectiveLines, {
        ...(thread?.status && { status: thread.status }),
        ...(thread?.createdAt && { createdAt: thread.createdAt }),
      }),
    [effectiveLines, thread?.createdAt, thread?.status],
  );

  const mainFeedLayoutSignature = useMemo(
    () =>
      blocks
        .map((block) => {
          if (block.kind === "user-prompt") {
            return `u:${block.lineId}`;
          }
          if (block.kind === "assistant-message") {
            return `a:${block.text.length}:${block.streaming ? 1 : 0}`;
          }
          if (block.kind === "work-session" && block.inlineContent) {
            return `p:${block.sessionKey ?? ""}:${block.children.length}:${block.running ? 1 : 0}`;
          }
          return "";
        })
        .filter(Boolean)
        .join("|"),
    [blocks],
  );

  useLayoutEffect(() => {
    onPlannerLayoutChange?.();
  }, [mainFeedLayoutSignature, onPlannerLayoutChange]);

  return (
    <div className="run-log">
      {blocks.map((block, index) => (
        <RunLogBlock
          key={
            block.kind === "work-session" && block.sessionKey
              ? block.sessionKey
              : block.kind === "user-prompt"
                ? `user-${block.lineId}`
                : `${block.kind}-${index}`
          }
          block={block}
          {...(onRestorePrompt && { onRestorePrompt })}
          {...(modelByRole && { modelByRole })}
          {...(usageByRole && { usageByRole })}
          {...(context && { context })}
          {...(onPlannerLayoutChange && { onPlannerLayoutChange })}
        />
      ))}
    </div>
  );
}

function RunLogBlock({
  block,
  onRestorePrompt,
  modelByRole,
  usageByRole,
  context,
  onPlannerLayoutChange,
}: {
  block: ActivityLogBlock;
  onRestorePrompt?: (prompt: string) => void;
  modelByRole?: Record<string, string>;
  usageByRole?: Record<string, ThreadUsageSnapshot>;
  context?: ThreadContextSnapshot;
  onPlannerLayoutChange?: () => void;
}) {
  if (block.kind === "user-prompt") {
    return <UserPromptBlock text={block.text} {...(onRestorePrompt && { onRestorePrompt })} />;
  }
  if (block.kind === "work-session") {
    return (
      <WorkSessionBlock
        block={block}
        {...(modelByRole && { modelByRole })}
        {...(usageByRole && { usageByRole })}
        {...(context && { context })}
        {...(onPlannerLayoutChange && { onPlannerLayoutChange })}
      />
    );
  }
  if (block.kind === "assistant-message") {
    return (
      <AssistantMessageBlock
        text={block.text}
        {...(block.streaming !== undefined && { streaming: block.streaming })}
        {...(block.subagent && { subagent: block.subagent })}
        {...(modelByRole && { modelByRole })}
        {...(usageByRole && { usageByRole })}
      />
    );
  }
  return null;
}

function SubagentClusterCard({
  sessionKey,
  running,
  roles,
  logLine,
  metaEntries,
  durationMs = 0,
  onToggle,
  expanded,
}: {
  sessionKey?: string;
  running: boolean;
  roles: readonly string[];
  logLine?: string;
  metaEntries: SubagentMetaEntry[];
  durationMs?: number;
  onToggle: () => void;
  expanded: boolean;
}) {
  const [liveDurationMs, setLiveDurationMs] = useState(durationMs);

  useEffect(() => {
    if (!running) {
      setLiveDurationMs(durationMs);
      return;
    }

    const baselineMs = durationMs;
    const anchorAt = Date.now();
    const tick = () => setLiveDurationMs(baselineMs + (Date.now() - anchorAt));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [running, durationMs, sessionKey]);

  const chips = buildSubagentChips(roles);
  const agentCount = roles.length;
  const singleMeta = metaEntries.length === 1 ? metaEntries[0] : undefined;
  const elapsedMs = running ? liveDurationMs : durationMs;
  const durationLabel =
    elapsedMs !== undefined && (running || elapsedMs > 0)
      ? running
        ? formatDuration(elapsedMs)
        : `用时 ${formatDuration(elapsedMs)}`
      : undefined;
  const fallbackText = running
    ? agentCount > 1
      ? `${agentCount} 个子代理工作中`
      : "工作中"
    : "点击查看执行详情";
  const displayLog = logLine?.trim() || fallbackText;

  return (
    <button
      type="button"
      className="subagent-cluster-card"
      onClick={onToggle}
      aria-expanded={expanded}
    >
      <div className="subagent-cluster-body">
        <div className="subagent-cluster-top">
          {chips.length > 0 ? (
            <div className="subagent-cluster-chips">
              {chips.map((chip) => (
                <span key={`${chip.role}-${chip.label}`} className="subagent-cluster-chip">
                  {chip.label}
                </span>
              ))}
            </div>
          ) : (
            <span className="subagent-cluster-heading">子代理</span>
          )}
          {singleMeta && (singleMeta.modelShort || singleMeta.contextText) ? (
            <div className="subagent-cluster-inline-meta">
              {singleMeta.modelShort ? (
                <span className="subagent-cluster-inline-model" title={singleMeta.modelShort}>
                  {singleMeta.modelShort}
                </span>
              ) : null}
              {singleMeta.contextText ? (
                <span className="subagent-cluster-inline-ctx" title="上下文占用 / 窗口容量">
                  {singleMeta.contextText}
                </span>
              ) : null}
            </div>
          ) : null}
          <div className="subagent-cluster-trail">
            {durationLabel ? (
              <span className="subagent-cluster-duration" aria-live={running ? "polite" : undefined}>
                {durationLabel}
              </span>
            ) : null}
            {running ? <span className="subagent-cluster-loading" aria-hidden /> : null}
            <ChevronDown
              size={16}
              className={expanded ? "subagent-cluster-chevron open" : "subagent-cluster-chevron"}
              aria-hidden
            />
          </div>
        </div>
        {metaEntries.length > 1 ? (
          <div className="subagent-cluster-meta">
            {metaEntries.map((entry) => (
              <div key={entry.role} className="subagent-cluster-meta-row">
                <span className="subagent-cluster-meta-chip">{SUBAGENT_ROLE_SHORT[entry.role] ?? entry.role}</span>
                {entry.modelShort ? (
                  <span className="subagent-cluster-meta-model" title={entry.modelShort}>
                    {entry.modelShort}
                  </span>
                ) : null}
                {entry.contextText ? (
                  <span className="subagent-cluster-meta-ctx" title="上下文占用 / 窗口容量">
                    {entry.contextText}
                  </span>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
      </div>
      <div className="subagent-cluster-log-row">
        <span className="subagent-cluster-log" title={displayLog}>
          {displayLog}
        </span>
      </div>
    </button>
  );
}

function WorkSessionBlock({
  block,
  modelByRole,
  usageByRole,
  context,
  onPlannerLayoutChange,
}: {
  block: Extract<ActivityLogBlock, { kind: "work-session" }>;
  modelByRole?: Record<string, string>;
  usageByRole?: Record<string, ThreadUsageSnapshot>;
  context?: ThreadContextSnapshot;
  onPlannerLayoutChange?: () => void;
}) {
  const [expanded, setExpanded] = useState(() =>
    block.compactSubagentMode ? false : !block.defaultCollapsed,
  );
  const subagentDetailsScrollRef = useRef<HTMLDivElement>(null);

  const scrollSubagentDetailsToEnd = useCallback(() => {
    const container = subagentDetailsScrollRef.current;
    if (!container) {
      return;
    }
    container.scrollTop = container.scrollHeight;
  }, []);

  useEffect(() => {
    if (block.compactSubagentMode) {
      setExpanded(false);
    }
  }, [block.compactSubagentMode, block.sessionKey]);

  const subagentDetailsSignature = useMemo(
    () =>
      block.compactSubagentMode
        ? `${block.sessionKey ?? ""}:${block.children.length}:${block.latestSubagentLogLine ?? ""}:${block.running ? 1 : 0}`
        : "",
    [
      block.children.length,
      block.compactSubagentMode,
      block.latestSubagentLogLine,
      block.running,
      block.sessionKey,
    ],
  );

  useLayoutEffect(() => {
    if (!block.compactSubagentMode || !expanded) {
      return;
    }
    scrollSubagentDetailsToEnd();
    const frame = requestAnimationFrame(scrollSubagentDetailsToEnd);
    return () => cancelAnimationFrame(frame);
  }, [block.compactSubagentMode, expanded, scrollSubagentDetailsToEnd, subagentDetailsSignature]);

  useLayoutEffect(() => {
    if (!block.inlineContent) {
      return;
    }
    onPlannerLayoutChange?.();
  }, [
    block.awaitingFirstToken,
    block.children,
    block.inlineContent,
    block.running,
    onPlannerLayoutChange,
  ]);

  const displayRoles = block.subagentRunRole
    ? block.running && block.activeSubagents && block.activeSubagents.length > 0
      ? block.activeSubagents.filter((role) => role === block.subagentRunRole)
      : [block.subagentRunRole]
    : block.activeSubagents && block.activeSubagents.length > 0
      ? block.activeSubagents
      : extractSubagentRolesFromChildren(block.children);
  const metaEntries = buildSubagentMetaEntries(displayRoles, modelByRole, usageByRole, context);
  const activeLabel = block.activeSubagent
    ? formatRoleModelLabel(block.activeSubagent, modelByRole?.[block.activeSubagent])
    : "";
  const sessionTiming = useStreamRequestTiming(
    block.running && Boolean(block.awaitingFirstToken),
    block.running && !block.awaitingFirstToken,
  );

  const label = block.running
    ? `处理中${activeLabel ? ` · ${activeLabel}` : ""}…`
    : `已处理 ${formatDuration(block.durationMs)}`;

  if (block.compactSubagentMode) {
    return (
      <section className="work-session work-session-compact">
        <SubagentClusterCard
          {...(block.sessionKey && { sessionKey: block.sessionKey })}
          running={block.running}
          roles={displayRoles}
          metaEntries={metaEntries}
          durationMs={block.runDurationMs ?? 0}
          {...(block.latestSubagentLogLine && { logLine: block.latestSubagentLogLine })}
          expanded={expanded}
          onToggle={() => {
            setExpanded((current) => {
              const next = !current;
              if (next) {
                requestAnimationFrame(scrollSubagentDetailsToEnd);
              }
              return next;
            });
          }}
        />
        {expanded && block.children.length > 0 ? (
          <div className="work-session-details-compact">
            <p className="work-session-details-compact-title">子代理执行详情</p>
            <div ref={subagentDetailsScrollRef} className="work-session-details-compact-scroll">
              {block.children.map((child, index) => (
                <DetailBlock
                  key={`${child.kind}-${index}`}
                  block={child}
                  hideSubagentIdentity
                  {...(modelByRole && { modelByRole })}
                  {...(usageByRole && { usageByRole })}
                />
              ))}
            </div>
          </div>
        ) : null}
      </section>
    );
  }

  if (block.inlineContent) {
    const showRunningHint =
      block.running && (block.children.length === 0 || Boolean(block.awaitingFirstToken));
    return (
      <section className="work-session work-session-inline">
        {showRunningHint ? (
          <div className="work-session-inline-status" aria-live="polite">
            <span className="work-session-dot running" />
            <span className="work-session-label">
              {label}
              <RequestTimingBadge timing={sessionTiming} />
              {block.activeMissionSummary ? (
                <span className="work-session-mission">{block.activeMissionSummary}</span>
              ) : null}
            </span>
          </div>
        ) : null}
        {block.children.length > 0 ? (
          <div className="work-session-details">
            {block.children.map((child, index) => (
              <DetailBlock
                key={`${child.kind}-${index}`}
                block={child}
                {...(modelByRole && { modelByRole })}
                {...(usageByRole && { usageByRole })}
              />
            ))}
          </div>
        ) : null}
      </section>
    );
  }

  return (
    <section className="work-session">
      <button
        type="button"
        className="work-session-toggle"
        onClick={() => setExpanded((current) => !current)}
        aria-expanded={expanded}
        disabled={block.running && block.children.length === 0 && !block.awaitingFirstToken}
      >
        <span className={`work-session-dot${block.running ? " running" : ""}`} />
        <span className="work-session-label">
          {label}
          {block.running ? <RequestTimingBadge timing={sessionTiming} /> : null}
          {block.activeMissionSummary ? (
            <span className="work-session-mission">{block.activeMissionSummary}</span>
          ) : null}
        </span>
        {!block.running && block.children.length > 0 ? (
          <ChevronDown size={16} className={expanded ? "work-session-chevron" : "work-session-chevron collapsed"} />
        ) : null}
      </button>
      {expanded && block.children.length > 0 ? (
        <div className="work-session-details">
          {block.children.map((child, index) => (
            <DetailBlock
              key={`${child.kind}-${index}`}
              block={child}
              {...(modelByRole && { modelByRole })}
              {...(usageByRole && { usageByRole })}
            />
          ))}
        </div>
      ) : null}
      {!expanded && !block.running && block.children.length > 0 ? (
        <ul className="work-session-preview" aria-label="步骤摘要">
          {block.children
            .filter(
              (child) =>
                child.kind === "phase" || child.kind === "subagent-mission",
            )
            .slice(-4)
            .map((child, index) => (
              <li key={`preview-${index}`}>
                {child.kind === "subagent-mission" ? child.summary : child.label}
              </li>
            ))}
        </ul>
      ) : null}
    </section>
  );
}

function DetailBlock({
  block,
  modelByRole,
  usageByRole,
  hideSubagentIdentity,
}: {
  block: ActivityDetailBlock;
  modelByRole?: Record<string, string>;
  usageByRole?: Record<string, ThreadUsageSnapshot>;
  hideSubagentIdentity?: boolean;
}) {
  const omitSubagent = shouldOmitSubagentIdentity(block, hideSubagentIdentity);

  if (block.kind === "phase") {
    return <PhaseBlock label={block.label} {...(block.reconnecting && { reconnecting: block.reconnecting })} />;
  }
  if (block.kind === "subagent-mission") {
    return (
      <SubagentMissionBlock
        subagent={block.subagent}
        summary={block.summary}
        {...(block.prompt !== undefined && { prompt: block.prompt })}
        omitRoleLabel={omitSubagent}
        {...(!omitSubagent && modelByRole && { modelByRole })}
      />
    );
  }
  if (block.kind === "model-request") {
    return (
      <ModelRequestBlock
        {...(block.role && { role: block.role })}
        omitRoleLabel={omitSubagent}
        {...(!omitSubagent && modelByRole && { modelByRole })}
      />
    );
  }
  if (block.kind === "agent-request") {
    return (
      <AgentRequestBlock
        {...(block.subagent && { subagent: block.subagent })}
        omitRoleLabel={omitSubagent}
        {...(!omitSubagent && modelByRole && { modelByRole })}
      />
    );
  }
  if (block.kind === "action") {
    return (
      <RunLogAction
        icon={block.icon}
        label={block.label}
        {...(block.subagent && { subagent: block.subagent })}
        omitRoleLabel={omitSubagent}
        {...(!omitSubagent && modelByRole && { modelByRole })}
      />
    );
  }
  if (block.kind === "tool-failed") {
    return (
      <ToolFailedBlock
        tool={block.tool}
        {...(block.error && { error: block.error })}
        {...(block.subagent && { subagent: block.subagent })}
        omitRoleLabel={omitSubagent}
        {...(!omitSubagent && modelByRole && { modelByRole })}
      />
    );
  }
  if (block.kind === "thinking") {
    return (
      <ThinkingBlock
        text={block.text}
        {...(block.streaming !== undefined && { streaming: block.streaming })}
      />
    );
  }
  return (
    <RunLogNarrative
      text={block.text}
      {...(block.streaming !== undefined && { streaming: block.streaming })}
      {...(block.subagent && { subagent: block.subagent })}
      omitSubagentBadge={omitSubagent}
      {...(!omitSubagent && modelByRole && { modelByRole })}
      {...(!omitSubagent && usageByRole && { usageByRole })}
      compact
    />
  );
}

function PhaseBlock({ label, reconnecting }: { label: string; reconnecting?: boolean }) {
  if (reconnecting) {
    return (
      <div className="run-log-phase run-log-reconnect" role="status" aria-live="polite">
        <RefreshCw size={14} className="run-log-reconnect-icon spinning" aria-hidden />
        <span>{label}</span>
      </div>
    );
  }
  return <div className="run-log-phase">{label}</div>;
}

function RequestTimingBadge({
  timing,
}: {
  timing: ReturnType<typeof useStreamRequestTiming>;
}) {
  if (timing.phase === "idle") {
    return null;
  }
  if (timing.phase === "waiting") {
    return (
      <span className="run-log-request-timing" aria-live="polite">
        等待 {formatDurationMs(timing.waitingMs)}
      </span>
    );
  }
  return (
    <span className="run-log-request-timing done" aria-live="polite">
      首 token {formatDurationMs(timing.ttftMs ?? 0)}
    </span>
  );
}

function ThinkingBlock({ text, streaming }: { text: string; streaming?: boolean }) {
  const [collapsed, setCollapsed] = useState(true);
  const hasBody = text.trim().length > 0;
  const showBody = streaming || !collapsed;
  const timing = useStreamRequestTiming(Boolean(streaming) && !hasBody, hasBody);

  return (
    <div
      className={[
        "run-log-thinking",
        streaming ? "streaming" : "",
        !hasBody && streaming ? "empty" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <button
        type="button"
        className="run-log-thinking-header"
        onClick={() => {
          if (!streaming) {
            setCollapsed((value) => !value);
          }
        }}
        aria-expanded={showBody}
        disabled={streaming && !hasBody}
      >
        <span className="run-log-thinking-label">Thinking</span>
        <RequestTimingBadge timing={timing} />
        {!streaming && hasBody ? (
          <ChevronDown
            size={14}
            className={collapsed ? "run-log-thinking-chevron" : "run-log-thinking-chevron open"}
            aria-hidden
          />
        ) : null}
      </button>
      {showBody && hasBody ? (
        <div className="run-log-thinking-body">
          <MarkdownContent text={text} />
          {streaming ? <span className="run-log-cursor" aria-hidden /> : null}
        </div>
      ) : null}
    </div>
  );
}

function UserPromptBlock({
  text,
  onRestorePrompt,
}: {
  text: string;
  onRestorePrompt?: (prompt: string) => void;
}) {
  const bodyRef = useRef<HTMLPreElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [canToggle, setCanToggle] = useState(false);

  useLayoutEffect(() => {
    setCanToggle(false);
    const body = bodyRef.current;
    if (!body || expanded) {
      return;
    }

    const measure = () => {
      if (body.scrollHeight > body.clientHeight + 1) {
        setCanToggle(true);
      }
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(body);
    return () => observer.disconnect();
  }, [text, expanded]);

  return (
    <article className="run-log-user-prompt">
      <div className="run-log-user-prompt-content">
        <div
          className={[
            "run-log-user-prompt-body-wrap",
            !expanded ? "collapsed" : "",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          <pre
            ref={bodyRef}
            className={[
              "run-log-user-prompt-body",
              !expanded ? "collapsed" : "",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            {text}
          </pre>
          {canToggle && !expanded ? <div className="run-log-user-prompt-fade" aria-hidden /> : null}
        </div>
        {canToggle ? (
          <button
            type="button"
            className="run-log-user-prompt-expand"
            onClick={() => setExpanded((value) => !value)}
            aria-expanded={expanded}
          >
            {expanded ? "收起" : "展开全文"}
          </button>
        ) : null}
      </div>
      {onRestorePrompt ? (
        <div className="run-log-user-prompt-actions">
          <button
            type="button"
            className="run-log-user-prompt-action"
            onClick={() => onRestorePrompt(text)}
            aria-label="回到此节点"
            title="填入输入框"
          >
            <Reply size={14} />
          </button>
        </div>
      ) : null}
    </article>
  );
}

function AssistantMessageBlock({
  text,
  streaming,
  subagent,
  modelByRole,
  usageByRole,
}: {
  text: string;
  streaming?: boolean;
  subagent?: string;
  modelByRole?: Record<string, string>;
  usageByRole?: Record<string, ThreadUsageSnapshot>;
}) {
  return (
    <RunLogNarrative
      text={text}
      streaming={streaming}
      subagent={subagent}
      {...(modelByRole && { modelByRole })}
      {...(usageByRole && { usageByRole })}
    />
  );
}

function ModelRequestBlock({
  role,
  modelByRole,
  omitRoleLabel,
}: {
  role?: string;
  modelByRole?: Record<string, string>;
  omitRoleLabel?: boolean;
}) {
  const timing = useStreamRequestTiming(true, false);
  const roleLabel = omitRoleLabel
    ? "请求中"
    : role
      ? formatRoleModelLabel(role, modelByRole?.[role])
      : "模型";

  return (
    <div className="run-log-agent-request run-log-model-request">
      <Bot size={16} className="run-log-agent-request-icon" aria-hidden />
      <span className="run-log-agent-request-label">
        {omitRoleLabel ? roleLabel : `${roleLabel} 请求中`}
        <RequestTimingBadge timing={timing} />
      </span>
    </div>
  );
}

function AgentRequestBlock({
  subagent,
  modelByRole,
  omitRoleLabel,
}: {
  subagent?: string;
  modelByRole?: Record<string, string>;
  omitRoleLabel?: boolean;
}) {
  const timing = useStreamRequestTiming(true, false);
  const roleLabel = omitRoleLabel
    ? "请求中"
    : subagent
      ? formatRoleModelLabel(subagent, modelByRole?.[subagent])
      : "子代理";

  return (
    <div className="run-log-agent-request">
      <Bot size={16} className="run-log-agent-request-icon" aria-hidden />
      <span className="run-log-agent-request-label">
        {omitRoleLabel ? roleLabel : `${roleLabel} 请求中`}
        <RequestTimingBadge timing={timing} />
      </span>
    </div>
  );
}

function SubagentMissionBlock({
  subagent,
  summary,
  prompt,
  modelByRole,
  omitRoleLabel,
}: {
  subagent: string;
  summary: string;
  prompt?: string;
  modelByRole?: Record<string, string>;
  omitRoleLabel?: boolean;
}) {
  const trimmedPrompt = prompt?.trim() ?? "";
  const genericSummary = isGenericMissionSummary(summary);
  const showPrompt = Boolean(
    trimmedPrompt && (trimmedPrompt !== summary.trim() || genericSummary),
  );
  const displaySummary =
    genericSummary && trimmedPrompt
      ? trimmedPrompt.split("\n").find((line) => line.trim())?.trim().slice(0, 200) ?? summary
      : summary;

  return (
    <div className="run-log-mission">
      <div className="run-log-mission-head">
        {!omitRoleLabel ? (
          <span className="run-log-mission-role">
            {formatRoleModelLabel(subagent, modelByRole?.[subagent])}
          </span>
        ) : null}
        <span className="run-log-mission-tag">任务目标</span>
      </div>
      {displaySummary.trim() ? (
        <p className="run-log-mission-summary">
          <MarkdownContent text={displaySummary} />
        </p>
      ) : (
        <p className="run-log-mission-summary run-log-mission-summary-muted">等待任务说明…</p>
      )}
      {showPrompt ? (
        <details className="run-log-mission-details" open={genericSummary}>
          <summary>查看完整任务说明</summary>
          <pre className="run-log-mission-prompt">{trimmedPrompt}</pre>
        </details>
      ) : null}
    </div>
  );
}

function ToolFailedBlock({
  tool,
  error,
  subagent,
  modelByRole,
  omitRoleLabel,
}: {
  tool: string;
  error?: string;
  subagent?: string;
  modelByRole?: Record<string, string>;
  omitRoleLabel?: boolean;
}) {
  return (
    <div className="run-log-tool-failed" role="alert">
      {subagent && !omitRoleLabel ? (
        <span className="run-log-tool-failed-role">
          {formatRoleModelLabel(subagent, modelByRole?.[subagent])}
        </span>
      ) : null}
      <span className="run-log-tool-failed-label">
        工具失败 · {tool}
      </span>
      {error ? <p className="run-log-tool-failed-error">{error}</p> : null}
    </div>
  );
}

function RunLogAction({
  icon,
  label,
  subagent,
  modelByRole,
  omitRoleLabel,
}: {
  icon: ActivityActionIcon;
  label: string;
  subagent?: string;
  modelByRole?: Record<string, string>;
  omitRoleLabel?: boolean;
}) {
  const Icon = actionIcons[icon];
  return (
    <div className="run-log-action">
      {subagent && !omitRoleLabel ? (
        <span className="run-log-action-role">{formatRoleModelLabel(subagent, modelByRole?.[subagent])}</span>
      ) : null}
      <Icon size={16} className="run-log-action-icon" aria-hidden />
      <span className="run-log-action-label">{label}</span>
    </div>
  );
}

const actionIcons = {
  search: Search,
  file: FileSearch,
  edit: Pencil,
  terminal: Terminal,
  agent: Bot,
} as const;

function RunLogNarrative({
  text,
  streaming,
  subagent,
  compact,
  modelByRole,
  usageByRole,
  omitSubagentBadge,
}: {
  text: string;
  streaming?: boolean;
  subagent?: string;
  compact?: boolean;
  modelByRole?: Record<string, string>;
  usageByRole?: Record<string, ThreadUsageSnapshot>;
  omitSubagentBadge?: boolean;
}) {
  const usage = subagent ? usageByRole?.[subagent] : undefined;
  const hasBody = text.trim().length > 0;
  const timing = useStreamRequestTiming(Boolean(streaming) && !hasBody, hasBody);
  const showSubagentBadge = subagent && !omitSubagentBadge;

  return (
    <div className={compact ? "run-log-narrative compact" : "run-log-narrative"}>
      {showSubagentBadge ? (
        <span className="run-log-subagent-badge">
          {formatRoleModelLabel(subagent, modelByRole?.[subagent])}
          {streaming ? <RequestTimingBadge timing={timing} /> : null}
          {usage ? (
            <span className="run-log-usage-badge">
              {formatUsageBadge({
                inputTokens: usage.inputTokens,
                outputTokens: usage.outputTokens,
                cacheReadTokens: usage.cacheReadTokens,
                cacheCreationTokens: usage.cacheCreationTokens,
              })}
            </span>
          ) : null}
        </span>
      ) : streaming ? (
        <RequestTimingBadge timing={timing} />
      ) : null}
      <div className="run-log-narrative-body">
        <MarkdownContent text={text} />
        {streaming ? <span className="run-log-cursor" aria-hidden /> : null}
      </div>
    </div>
  );
}
