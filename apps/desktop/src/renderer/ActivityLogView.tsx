import { Bot, ChevronDown, FileSearch, Pencil, Search, Terminal } from "lucide-react";
import { useMemo, useState } from "react";
import type { ThreadActivityLine, ThreadSummary } from "../shared/ipc";
import {
  buildActivityLogBlocks,
  type ActivityActionIcon,
  type ActivityLogBlock,
  splitNarrativeSegments,
} from "./activity-log";

interface ActivityLogViewProps {
  lines: ThreadActivityLine[];
  thread?: ThreadSummary;
}

export function ActivityLogView({ lines, thread }: ActivityLogViewProps) {
  const blocks = useMemo(
    () => buildActivityLogBlocks(lines, { status: thread?.status, createdAt: thread?.createdAt }),
    [lines, thread?.createdAt, thread?.status],
  );

  return (
    <div className="run-log">
      {blocks.map((block, index) => (
        <RunLogBlock key={`${block.kind}-${index}`} block={block} />
      ))}
    </div>
  );
}

function RunLogBlock({ block }: { block: ActivityLogBlock }) {
  if (block.kind === "progress") {
    return <RunLogProgress label={block.label} running={block.running} />;
  }
  if (block.kind === "phase") {
    return <div className="run-log-phase">{block.label}</div>;
  }
  if (block.kind === "action") {
    return <RunLogAction icon={block.icon} label={block.label} />;
  }
  return <RunLogNarrative text={block.text} streaming={block.streaming} />;
}

function RunLogProgress({ label, running }: { label: string; running: boolean }) {
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

function RunLogNarrative({ text, streaming }: { text: string; streaming?: boolean }) {
  const segments = splitNarrativeSegments(text);

  return (
    <div className="run-log-narrative">
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
