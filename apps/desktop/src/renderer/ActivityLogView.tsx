import { Bot, Check, ChevronDown, Copy, FileSearch, Pencil, Reply, Search, Terminal } from "lucide-react";
import { useMemo, useState } from "react";
import type { ThreadActivityLine, ThreadSummary } from "../shared/ipc";
import { formatSubagentLabel } from "@eco/runtime";
import {
  buildActivityLogBlocks,
  type ActivityActionIcon,
  type ActivityLogBlock,
  splitNarrativeSegments,
} from "./activity-log";

interface ActivityLogViewProps {
  lines: ThreadActivityLine[];
  thread?: ThreadSummary;
  onRestorePrompt?: (prompt: string) => void;
}

export function ActivityLogView({ lines, thread, onRestorePrompt }: ActivityLogViewProps) {
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
        />
      ))}
    </div>
  );
}

function RunLogBlock({
  block,
  onRestorePrompt,
}: {
  block: ActivityLogBlock;
  onRestorePrompt?: (prompt: string) => void;
}) {
  if (block.kind === "progress") {
    return (
      <RunLogProgress
        label={block.label}
        running={block.running}
        {...(block.activeSubagent && { activeSubagent: block.activeSubagent })}
      />
    );
  }
  if (block.kind === "phase") {
    return <div className="run-log-phase">{block.label}</div>;
  }
  if (block.kind === "user-prompt") {
    return (
      <UserPromptBlock
        text={block.text}
        {...(onRestorePrompt && { onRestorePrompt })}
      />
    );
  }
  if (block.kind === "action") {
    return <RunLogAction icon={block.icon} label={block.label} />;
  }
  return (
    <RunLogNarrative
      text={block.text}
      {...(block.streaming !== undefined && { streaming: block.streaming })}
      {...(block.subagent && { subagent: block.subagent })}
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
  const [copied, setCopied] = useState(false);

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  return (
    <article className="run-log-user-prompt">
      <header className="run-log-user-prompt-head">
        <span className="run-log-user-prompt-label">你的需求</span>
        <div className="run-log-user-prompt-actions">
          <button
            type="button"
            className="run-log-user-prompt-action"
            onClick={() => void copyPrompt()}
            aria-label="复制原文"
            title="复制原文"
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {copied ? "已复制" : "复制"}
          </button>
          {onRestorePrompt ? (
            <button
              type="button"
              className="run-log-user-prompt-action"
              onClick={() => onRestorePrompt(text)}
              aria-label="回到此节点"
              title="填入输入框，可编辑后重新发送"
            >
              <Reply size={14} />
              回到此节点
            </button>
          ) : null}
        </div>
      </header>
      <pre className="run-log-user-prompt-body">{text}</pre>
    </article>
  );
}

function RunLogProgress({
  label,
  running,
  activeSubagent,
}: {
  label: string;
  running: boolean;
  activeSubagent?: string;
}) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <button
      type="button"
      className="run-log-progress"
      onClick={() => setCollapsed((current) => !current)}
      aria-expanded={!collapsed}
    >
      <span className={`run-log-progress-dot${running ? " running" : ""}`} />
      <span>{label}</span>
      {activeSubagent && running ? (
        <span className="run-log-subagent-chip">{formatSubagentLabel(activeSubagent)}</span>
      ) : null}
      <ChevronDown size={16} className={collapsed ? "run-log-chevron collapsed" : "run-log-chevron"} />
    </button>
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
}: {
  text: string;
  streaming?: boolean;
  subagent?: string;
}) {
  const segments = splitNarrativeSegments(text);

  return (
    <div className="run-log-narrative">
      {subagent ? (
        <span className="run-log-subagent-badge">{formatSubagentLabel(subagent)}</span>
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
