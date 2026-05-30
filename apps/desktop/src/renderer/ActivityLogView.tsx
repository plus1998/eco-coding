import { Bot, ChevronDown, Copy, FileSearch, Pencil, RefreshCw, Reply, Search, Terminal } from "lucide-react";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ThreadActivityLine, ThreadSummary } from "../shared/ipc";
import { formatRoleModelLabel, formatUsageBadge } from "@eco/runtime";
import type { ThreadUsageSnapshot } from "../shared/ipc";
import { formatDurationMs } from "./AppMessage";
import {
  buildActivityLogBlocks,
  formatDuration,
  type ActivityActionIcon,
  type ActivityDetailBlock,
  type ActivityLogBlock,
} from "./activity-log";
import { MarkdownContent } from "./MarkdownContent";
import { useStreamRequestTiming } from "./useStreamRequestTiming";

interface ActivityLogViewProps {
  lines: ThreadActivityLine[];
  thread?: ThreadSummary;
  onRestorePrompt?: (prompt: string) => void;
  modelByRole?: Record<string, string>;
  usageByRole?: Record<string, ThreadUsageSnapshot>;
}

export function ActivityLogView({
  lines,
  thread,
  onRestorePrompt,
  modelByRole,
  usageByRole,
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

  return (
    <div className="run-log">
      {blocks.map((block, index) => (
        <RunLogBlock
          key={`${block.kind}-${index}`}
          block={block}
          {...(onRestorePrompt && { onRestorePrompt })}
          {...(modelByRole && { modelByRole })}
          {...(usageByRole && { usageByRole })}
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
}: {
  block: ActivityLogBlock;
  onRestorePrompt?: (prompt: string) => void;
  modelByRole?: Record<string, string>;
  usageByRole?: Record<string, ThreadUsageSnapshot>;
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

function WorkSessionBlock({
  block,
  modelByRole,
  usageByRole,
}: {
  block: Extract<ActivityLogBlock, { kind: "work-session" }>;
  modelByRole?: Record<string, string>;
  usageByRole?: Record<string, ThreadUsageSnapshot>;
}) {
  const [expanded, setExpanded] = useState(!block.defaultCollapsed);
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
                child.kind === "action" || child.kind === "phase" || child.kind === "subagent-mission",
            )
            .slice(-4)
            .map((child, index) => (
              <li key={`preview-${index}`}>
                {child.kind === "subagent-mission"
                  ? `${formatRoleModelLabel(child.subagent, modelByRole?.[child.subagent])}：${child.summary}`
                  : child.label}
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
}: {
  block: ActivityDetailBlock;
  modelByRole?: Record<string, string>;
  usageByRole?: Record<string, ThreadUsageSnapshot>;
}) {
  if (block.kind === "phase") {
    return <PhaseBlock label={block.label} {...(block.reconnecting && { reconnecting: block.reconnecting })} />;
  }
  if (block.kind === "subagent-mission") {
    return (
      <SubagentMissionBlock
        subagent={block.subagent}
        summary={block.summary}
        prompt={block.prompt}
        {...(modelByRole && { modelByRole })}
      />
    );
  }
  if (block.kind === "model-request") {
    return (
      <ModelRequestBlock
        {...(block.role && { role: block.role })}
        {...(modelByRole && { modelByRole })}
      />
    );
  }
  if (block.kind === "agent-request") {
    return (
      <AgentRequestBlock
        {...(block.subagent && { subagent: block.subagent })}
        {...(modelByRole && { modelByRole })}
      />
    );
  }
  if (block.kind === "action") {
    return (
      <RunLogAction
        icon={block.icon}
        label={block.label}
        {...(block.subagent && { subagent: block.subagent })}
        {...(modelByRole && { modelByRole })}
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
      {...(modelByRole && { modelByRole })}
      {...(usageByRole && { usageByRole })}
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
}: {
  role?: string;
  modelByRole?: Record<string, string>;
}) {
  const timing = useStreamRequestTiming(true, false);
  const roleLabel = role ? formatRoleModelLabel(role, modelByRole?.[role]) : "模型";

  return (
    <div className="run-log-agent-request run-log-model-request">
      <Bot size={16} className="run-log-agent-request-icon" aria-hidden />
      <span className="run-log-agent-request-label">
        {roleLabel} 请求中
        <RequestTimingBadge timing={timing} />
      </span>
    </div>
  );
}

function AgentRequestBlock({
  subagent,
  modelByRole,
}: {
  subagent?: string;
  modelByRole?: Record<string, string>;
}) {
  const timing = useStreamRequestTiming(true, false);
  const roleLabel = subagent ? formatRoleModelLabel(subagent, modelByRole?.[subagent]) : "子代理";

  return (
    <div className="run-log-agent-request">
      <Bot size={16} className="run-log-agent-request-icon" aria-hidden />
      <span className="run-log-agent-request-label">
        {roleLabel} 请求中
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
}: {
  subagent: string;
  summary: string;
  prompt?: string;
  modelByRole?: Record<string, string>;
}) {
  const showPrompt = Boolean(prompt && prompt.trim() && prompt.trim() !== summary.trim());

  return (
    <div className="run-log-mission">
      <div className="run-log-mission-head">
        <span className="run-log-mission-role">
          {formatRoleModelLabel(subagent, modelByRole?.[subagent])}
        </span>
        <span className="run-log-mission-tag">任务目标</span>
      </div>
      <p className="run-log-mission-summary">
        <MarkdownContent text={summary} />
      </p>
      {showPrompt ? (
        <details className="run-log-mission-details">
          <summary>查看完整任务说明</summary>
          <pre className="run-log-mission-prompt">{prompt}</pre>
        </details>
      ) : null}
    </div>
  );
}

function RunLogAction({
  icon,
  label,
  subagent,
  modelByRole,
}: {
  icon: ActivityActionIcon;
  label: string;
  subagent?: string;
  modelByRole?: Record<string, string>;
}) {
  const Icon = actionIcons[icon];
  return (
    <div className="run-log-action">
      {subagent ? (
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
}: {
  text: string;
  streaming?: boolean;
  subagent?: string;
  compact?: boolean;
  modelByRole?: Record<string, string>;
  usageByRole?: Record<string, ThreadUsageSnapshot>;
}) {
  const usage = subagent ? usageByRole?.[subagent] : undefined;
  const hasBody = text.trim().length > 0;
  const timing = useStreamRequestTiming(Boolean(streaming) && !hasBody, hasBody);

  return (
    <div className={compact ? "run-log-narrative compact" : "run-log-narrative"}>
      {subagent ? (
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
