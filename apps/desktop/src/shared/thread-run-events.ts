export type ThreadRunEventScope = "main" | "agent" | "both";

export type ThreadRunEventStreamState = "none" | "placeholder" | "streaming" | "finalized";

export const CONTEXT_COMPACTION_EVENT_TYPES = [
  "context.compaction.started",
  "context.compaction.completed",
  "context.compaction.failed",
  "context.compaction.suspended",
] as const;

export function isContextCompactionEventType(
  value: unknown,
): value is (typeof CONTEXT_COMPACTION_EVENT_TYPES)[number] {
  return CONTEXT_COMPACTION_EVENT_TYPES.some((type) => type === value);
}

export type ThreadRunEventType =
  | "thread.status"
  | "run.attempt.started"
  | "run.attempt.completed"
  | "run.attempt.failed"
  | "run.attempt.cancelled"
  | "agent.started"
  | "agent.stopped"
  | "agent.abandoned"
  | "request.started"
  | "request.first_token"
  | "request.completed"
  | "request.failed"
  | "request.cancelled"
  | "request.retry_scheduled"
  | "context.compaction.started"
  | "context.compaction.completed"
  | "context.compaction.failed"
  | "context.compaction.suspended"
  | "context.cache_config_drift"
  | "context.cache_invalidated"
  | "billing.cache_hit_dropped"
  | "message.delta"
  | "message.final"
  | "thinking.delta"
  | "thinking.final"
  | "tool.started"
  | "tool.completed"
  | "tool.failed"
  | "api.error"
  | "diagnostic";

import type { ThreadRunFileChangeMetadata } from "./file-change";
import type { ThreadRunGrepToolTarget, ThreadRunReadToolTarget } from "./tool-target";

export interface ThreadRunToolMetadata {
  name: string;
  detail?: string;
  outputPreview?: string;
  outputPreviewTruncated?: boolean;
  toolUseId?: string;
  durationMs?: number;
  exitCode?: number;
  status?: "started" | "completed" | "failed";
  /**
   * When set on a failed tool, distinguishes SDK non-execution outcomes
   * (`tool_result_meta.non_execution_kind` / JSONL `toolDenialKind`) from real
   * execution errors. `cancelled` is usually a control-channel abort, not a
   * user tapping Deny.
   */
  nonExecutionKind?: "denied" | "interrupted" | "cancelled";
  /** Human-readable Bash title from Agent input or Codex commandActions. */
  description?: string;
  fileChange?: ThreadRunFileChangeMetadata;
  readTarget?: ThreadRunReadToolTarget;
  grepTarget?: ThreadRunGrepToolTarget;
  /** Codex webSearch / Claude WebSearch structured fields for Feed cards. */
  webSearch?: ThreadRunWebSearchMetadata;
  /** Codex view_image structured fields for Feed previews. */
  imageView?: ThreadRunImageViewMetadata;
  /** eco_image_display.display_image artifact for user-facing feed previews. */
  imageDisplay?: ThreadRunImageDisplayMetadata;
  /** eco_html_host.publish_html hosted page for Feed cards. */
  htmlHost?: ThreadRunHtmlHostMetadata;
  /** PI `mcp({ search })` / `mcp({ action })` probes before a real `{ tool, args }` call. */
  mcpDiscovery?: ThreadRunMcpDiscoveryMetadata;
  /** Planner → subagent SendMessage resume/follow-up payload. */
  sendMessage?: ThreadRunSendMessageMetadata;
}

/**
 * `imageView` 会在四个地方各自被重建——store 读回、Feed 投影、tool 投影、SDK 采集。
 * 每处都只挑自己认识的字段，于是新增的 `prompt` 被逐个丢掉，卡片就只剩下图片。
 * 所有读取都走这一个解析器，下次加字段不会再漏。
 */
export function parseThreadRunImageViewMetadata(value: unknown): ThreadRunImageViewMetadata | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const path = typeof record.path === "string" ? record.path.trim() : "";
  if (!path) {
    return undefined;
  }
  const prompt = typeof record.prompt === "string" ? record.prompt.trim() : "";
  return { path, ...(prompt ? { prompt } : {}) };
}

export interface ThreadRunSendMessageMetadata {
  recipient?: string;
  summary?: string;
  message?: string;
  success?: boolean;
  resultMessage?: string;
  resumedAgentId?: string;
}

export interface ThreadRunImageViewMetadata {
  /** Path resolved by Codex in the selected execution environment. */
  path: string;
  /**
   * The caller's own instruction for the vision model. Kept beside the path so the
   * preview can show what was asked next to the answer the tool returned.
   */
  prompt?: string;
}

/**
 * `tool.started` and `tool.completed` arrive as two events whose metadata gets merged, and the
 * two halves are not distributed evenly: the prompt is known when the call starts, the path may
 * only be resolvable at the end. So merge field by field instead of letting the later event win
 * wholesale — otherwise a card that learned the question early loses it on completion.
 */
export function mergeThreadRunImageViewMetadata(
  existing: ThreadRunImageViewMetadata | undefined,
  incoming: ThreadRunImageViewMetadata | undefined,
): ThreadRunImageViewMetadata | undefined {
  const base = incoming ?? existing;
  if (!base) {
    return undefined;
  }
  const prompt = base.prompt ?? existing?.prompt ?? incoming?.prompt;
  return prompt ? { ...base, prompt } : base;
}

export interface ThreadRunImageDisplayMetadata {
  artifactId: string;
  title?: string;
}

export interface ThreadRunHtmlHostMetadata {
  pageId: string;
  publicUrl: string;
  title?: string;
  expiresAt?: string;
  canExtend?: boolean;
}

export interface ThreadRunMcpDiscoveryMetadata {
  kind: "search";
}

/** Structured network tool payload for desktop/mobile web-search cards. */
export interface ThreadRunWebSearchMetadata {
  /** Primary query string (WebSearch) or URL (WebFetch may reuse detail). */
  query?: string;
  /** Codex WebSearchAction discriminant. */
  actionType?: "search" | "openPage" | "findInPage" | "other";
  url?: string;
  pattern?: string;
  queries?: string[];
  /** Distinguishes search vs page fetch when name alone is ambiguous. */
  mode?: "search" | "fetch";
  /** Integrated search provider label when known (doubao / tavily / brave). */
  provider?: string;
  /** Public SERP hits for Feed cards (Eco Integrated / MCP search). */
  results?: ThreadRunWebSearchResultHit[];
}

export interface ThreadRunWebSearchResultHit {
  title: string;
  url: string;
  description?: string;
}

export type ThreadRunBashApprovalPhase = "requested" | "approved" | "rejected" | "denied";

export interface ThreadRunBashApprovalMetadata {
  toolUseId: string;
  phase: ThreadRunBashApprovalPhase;
  toolName: string;
  detail?: string;
  description?: string;
}

export interface ThreadRunEvent {
  id: string;
  threadId: string;
  /** Timeline order and incremental sync version; advances when cumulative stream content changes. */
  sequence: number;
  eventType: ThreadRunEventType;
  scope: ThreadRunEventScope;
  streamState: ThreadRunEventStreamState;
  message: string;
  observedAt: string;
  role?: string;
  agentId?: string;
  parentAgentId?: string;
  parentToolUseId?: string;
  runAttemptId?: string;
  requestId?: string;
  streamKey?: string;
  metadata?: Record<string, unknown>;
}

export type ThreadRunEventInput = Omit<ThreadRunEvent, "sequence"> & {
  sequence?: number;
};
