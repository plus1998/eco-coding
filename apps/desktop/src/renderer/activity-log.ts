import type { BashRunCardDisplay, FileChangeCardDisplay, ToolActionLifecycle } from "../shared/activity-display";
import type { GrepToolTargetDisplay, ReadToolTargetDisplay } from "../shared/tool-target";
import { isReconnectActivityMessage } from "../shared/activity-display";
import type { ThreadSubagentSessionTiming } from "../shared/ipc";
import type { WorktreeMergeSummary } from "../shared/worktree-merge";

export { isReconnectActivityMessage };
export { resolveSubagentRunDisplayTitle, normalizeSubagentDisplayRole } from "../shared/subagent-roles";
export type { WorktreeMergeSummary };
export type { ToolActionLifecycle };

export function buildSubagentTimingsByAgentId(
  sessions: readonly ThreadSubagentSessionTiming[],
): Record<string, ThreadSubagentSessionTiming> {
  const map: Record<string, ThreadSubagentSessionTiming> = {};
  for (const session of sessions) {
    map[session.agentId] = session;
  }
  return map;
}

export function buildSubagentMetricsByAgentId<T extends { agentId: string }>(
  rows: readonly T[],
): Record<string, T> {
  const map: Record<string, T> = {};
  for (const row of rows) {
    map[row.agentId] = row;
  }
  return map;
}

export type ActivityActionIcon = "search" | "file" | "edit" | "terminal" | "agent";

export type ActivityDetailBlock =
  | { kind: "phase"; label: string; reconnecting?: boolean; reconnectFailed?: boolean; reconnectDetail?: string }
  | {
      kind: "prompt-cache-timeline";
      narrative: string;
      steps: Array<{
        kind: "config_drift" | "invalidated" | "hit_dropped";
        at: string;
        label: string;
        episodeId?: string;
      }>;
    }
  | { kind: "subagent-mission"; subagent: string; summary: string; prompt?: string; agentId?: string }
  | { kind: "model-request"; role?: string }
  | { kind: "agent-request"; subagent?: string; agentId?: string }
  | {
      kind: "thinking";
      text: string;
      streaming?: boolean;
      subagent?: string;
      agentId?: string;
    }
  | { kind: "narrative"; text: string; streaming?: boolean; subagent?: string; agentId?: string }
  | {
      kind: "action";
      icon: ActivityActionIcon;
      label: string;
      lifecycle?: ToolActionLifecycle;
      toolName?: string;
      subagent?: string;
      agentId?: string;
      bashRun?: BashRunCardDisplay;
      fileChange?: FileChangeCardDisplay;
      readTarget?: ReadToolTargetDisplay;
      grepTarget?: GrepToolTargetDisplay;
    }
  | {
      kind: "tool-failed";
      tool: string;
      command?: string;
      error?: string;
      recoveredResult?: {
        kind: "patch-applied-verification-empty";
        files: Array<{ status: string; path: string }>;
      };
      subagent?: string;
      agentId?: string;
    }
  | {
      kind: "api-error";
      message: string;
      statusCode?: number;
      code?: string;
      subagent?: string;
      agentId?: string;
    }
  | { kind: "worktree-merge"; summary: WorktreeMergeSummary };

function clampPreviewLine(text: string, max: number): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  if (oneLine.length <= max) {
    return oneLine;
  }
  return `${oneLine.slice(0, max - 1)}…`;
}

/** Single-line preview for collapsed thinking blocks. */
export function thinkingPreviewLine(text: string, max = 120): string {
  const plain = text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/^#+\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
  return clampPreviewLine(plain, max);
}

export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, ms / 1000);
  if (totalSeconds < 60) {
    return `${totalSeconds.toFixed(1)}s`;
  }
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

type ToolCategory = "read" | "search" | "edit" | "run" | "agent";

function categorizeTool(tool: string): ToolCategory {
  if (tool === "Agent" || tool === "Task" || tool === "TaskList" || tool === "TaskOutput") {
    return "agent";
  }
  if (tool === "Bash") {
    return "run";
  }
  if (
    tool === "Write" ||
    tool === "Edit" ||
    tool === "MultiEdit" ||
    tool === "TaskCreate" ||
    tool === "TaskUpdate" ||
    tool === "TodoWrite"
  ) {
    return "edit";
  }
  if (tool === "Glob" || tool === "Grep") {
    return "search";
  }
  return "read";
}

function iconForToolCategory(category: ToolCategory): ActivityActionIcon {
  if (category === "search") {
    return "search";
  }
  if (category === "edit") {
    return "edit";
  }
  if (category === "run") {
    return "terminal";
  }
  if (category === "agent") {
    return "agent";
  }
  return "file";
}

export function iconForToolName(toolName: string): ActivityActionIcon {
  return iconForToolCategory(categorizeTool(toolName));
}
