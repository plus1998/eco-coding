import type {
  BashRunCardDisplay,
  FileChangeCardDisplay,
  ToolActionLifecycle,
  WebSearchCardDisplay,
} from "../shared/activity-display";
import { isReconnectActivityMessage } from "../shared/activity-display";
import { isEcoAgentBrowserToolName } from "../shared/browser";
import { isEcoImageGenerationToolName } from "../shared/image-generation";
import { isEcoImageViewToolName } from "../shared/image-view-tool";
import type { ThreadSubagentSessionTiming } from "../shared/ipc";
import {
  normalizeSubagentDisplayRole,
  resolveSubagentRunDisplayTitle as resolveSharedSubagentRunDisplayTitle,
} from "../shared/subagent-roles";
import type { GrepToolTargetDisplay, ReadToolTargetDisplay } from "../shared/tool-target";
import type { WorktreeMergeSummary } from "../shared/worktree-merge";
import { i18n } from "./i18n";

export type { ToolActionLifecycle, WorktreeMergeSummary };
export { isReconnectActivityMessage, normalizeSubagentDisplayRole };

export function resolveSubagentRunDisplayTitle(role: string): string {
  return resolveSharedSubagentRunDisplayTitle(role, (key) => i18n.t(key));
}

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

export type ActivityActionIcon =
  | "search"
  | "file"
  | "image"
  | "browser"
  | "edit"
  | "terminal"
  | "agent"
  | "context"
  | "network";

export type ActivityDetailBlock =
  | {
      kind: "phase";
      label: string;
      reconnecting?: boolean;
      reconnectFailed?: boolean;
      reconnectDetail?: string;
    }
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
  | {
      kind: "subagent-mission";
      subagent: string;
      summary: string;
      prompt?: string;
      agentId?: string;
    }
  | { kind: "subagent-prompt"; text: string; subagent?: string; agentId?: string }
  | { kind: "model-request"; role?: string }
  | { kind: "agent-request"; subagent?: string; agentId?: string }
  | {
      kind: "thinking";
      text: string;
      streaming?: boolean;
      subagent?: string;
      agentId?: string;
      startedAt?: string;
      endedAt?: string;
      durationMs?: number;
    }
  | {
      /** OpenAI/Codex reasoning summary — single-line stage status (not long thinking card). */
      kind: "reasoning-stage";
      label: string;
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
      webSearch?: WebSearchCardDisplay;
      imageView?: { path: string; eventId: string };
      mcpDiscovery?: { kind: "search" };
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
      kind: "unknown-item";
      itemType: string;
      phase?: "started" | "completed";
      payload?: string;
      streaming?: boolean;
      subagent?: string;
      agentId?: string;
    }
  | {
      kind: "api-error";
      message: string;
      title?: string;
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

/**
 * A reasoning "summary" longer than this is really the reasoning body and
 * should render as a collapsible thinking block instead of a one-line tip.
 */
export const reasoningSummaryMaxLines = 3;

/**
 * Reasoning summary label — keeps natural line breaks so the tip status can
 * wrap onto multiple lines. Strips markdown markers like the preview line but
 * does not flatten whitespace. Keeps a generous `maxLines` (default 20) as a
 * sanity bound against pathological inputs; line-count vs
 * `reasoningSummaryMaxLines` decides tip vs thinking-body at the call site.
 */
export function reasoningSummaryLabel(text: string, maxLines = 20): string {
  const plain = text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/^#+\s+/gm, "")
    .replace(/[ \t]+/g, " ")
    .trim();
  const lines = plain.split("\n");
  if (lines.length <= maxLines) {
    return plain;
  }
  return lines.slice(-maxLines).join("\n");
}

export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  // Sub-second (or zero) durations omit the label — avoid "已思考 0s".
  if (totalSeconds <= 0) {
    return "";
  }
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts: string[] = [];
  if (hours > 0) {
    parts.push(`${hours}h`);
  }
  if (minutes > 0) {
    parts.push(`${minutes}m`);
  }
  if (seconds > 0 || parts.length === 0) {
    parts.push(`${seconds}s`);
  }
  return parts.join(" ");
}

type ToolCategory =
  | "read"
  | "search"
  | "image"
  | "browser"
  | "edit"
  | "run"
  | "agent"
  | "network"
  | "skill"
  | "mcp";

function categorizeTool(tool: string): ToolCategory {
  const name = tool.trim().toLowerCase();
  if (
    name === "agent" ||
    name === "task" ||
    name === "tasklist" ||
    name === "taskoutput"
  ) {
    return "agent";
  }
  if (name === "bash" || name === "shell" || name === "cmd" || name === "powershell") {
    return "run";
  }
  if (
    name === "write" ||
    name === "edit" ||
    name === "multiedit" ||
    name === "notebookedit" ||
    name === "taskcreate" ||
    name === "taskupdate" ||
    name === "todowrite"
  ) {
    return "edit";
  }
  if (name === "websearch" || name === "webfetch") {
    return "network";
  }
  if (name === "viewimage" || isEcoImageGenerationToolName(tool) || isEcoImageViewToolName(tool)) {
    return "image";
  }
  if (isEcoAgentBrowserToolName(tool)) {
    return "browser";
  }
  if (name === "glob" || name === "grep" || name === "find" || name === "ls") {
    return "search";
  }
  if (name === "mcp" || name === "mcpscript" || name === "mcp_tool" || name.startsWith("mcp__")) {
    return "mcp";
  }
  if (name === "skill" || name === "skills" || name === "readskill" || name.includes("skill")) {
    return "skill";
  }
  return "read";
}

function iconForToolCategory(category: ToolCategory): ActivityActionIcon {
  if (category === "search") {
    return "search";
  }
  if (category === "network") {
    return "network";
  }
  if (category === "image") {
    return "image";
  }
  if (category === "browser") {
    return "browser";
  }
  if (category === "skill") {
    return "file";
  }
  if (category === "mcp") {
    return "network";
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

// 补充桌面端 Read/Grep 等文字事件的图标映射（与 shared/activity-display.ts 一致）
export function resolveDesktopIcon(toolName: string): ActivityActionIcon {
  const normalized = toolName.toLowerCase();
  const map: Record<string, ActivityActionIcon> = {
    read: "file",
    grep: "search",
    edit: "edit",
    write: "edit",
    bash: "terminal",
    agent: "agent",
    websearch: "network",
    webfetch: "network",
    skill: "file",
    view_image: "image",
    image: "image",
    glob: "search",
    todowrite: "edit",
    taskcreate: "edit",
    taskupdate: "edit",
    tasklist: "list",
    taskoutput: "file-text",
    askuserquestion: "message-circle",
    mcp: "network",
    mcpscript: "code",
  };
  return map[normalized] ?? map[toolName.toLowerCase()] ?? "file";
}
