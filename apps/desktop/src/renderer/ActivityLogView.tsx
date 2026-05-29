import { Bot, ChevronDown, Copy, FileSearch, Pencil, Reply, Search, Terminal } from "lucide-react";
import { useMemo, useState } from "react";
import type { ThreadActivityLine, ThreadSummary } from "../shared/ipc";
import { formatRoleModelLabel, formatUsageBadge } from "@eco/runtime";
import type { ThreadUsageSnapshot } from "../shared/ipc";
import {
  buildActivityLogBlocks,
  formatDuration,
  type ActivityActionIcon,
  type ActivityDetailBlock,
  type ActivityLogBlock,
  splitNarrativeSegments,
} from "./activity-log";

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
        disabled={block.running && block.children.length === 0}
      >
        <span className={`work-session-dot${block.running ? " running" : ""}`} />
        <span className="work-session-label">{label}</span>
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
    return <div className="run-log-phase">{block.label}</div>;
  }
  if (block.kind === "action") {
    return <RunLogAction icon={block.icon} label={block.label} />;
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

function UserPromptBlock({
  text,
  onRestorePrompt,
}: {
  text: string;
  onRestorePrompt?: (prompt: string) => void;
}) {
  return (
    <article className="run-log-user-prompt">
      <pre className="run-log-user-prompt-body">{text}</pre>
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

function RunLogAction({ icon, label }: { icon: ActivityActionIcon; label: string }) {
  const Icon = actionIcons[icon];
  return (
    <div className="run-log-action">
      <Icon size={16} className="run-log-action-icon" aria-hidden />
      <span>{label}</span>
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
  const segments = splitNarrativeSegments(text);
  const usage = subagent ? usageByRole?.[subagent] : undefined;

  return (
    <div className={compact ? "run-log-narrative compact" : "run-log-narrative"}>
      {subagent ? (
        <span className="run-log-subagent-badge">
          {formatRoleModelLabel(subagent, modelByRole?.[subagent])}
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
      ) : null}
      <p>
        {segments.map((segment, index) =>
          segment.type === "code" ? (
            <code key={index} className="run-log-code">
              {segment.value}
            </code>
          ) : (
            <span key={index}>{segment.value}</span>
          ),
        )}
        {streaming ? <span className="run-log-cursor" aria-hidden /> : null}
      </p>
    </div>
  );
}
