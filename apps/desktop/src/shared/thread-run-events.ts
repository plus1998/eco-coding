export type ThreadRunEventScope = "main" | "agent" | "both";

export type ThreadRunEventStreamState =
  | "none"
  | "placeholder"
  | "streaming"
  | "finalized";

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
  | "context.tool_output_truncated"
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
  output?: string;
  toolUseId?: string;
  durationMs?: number;
  status?: "started" | "completed" | "failed";
  /** Human-readable Bash title from Agent input or Codex commandActions. */
  description?: string;
  fileChange?: ThreadRunFileChangeMetadata;
  readTarget?: ThreadRunReadToolTarget;
  grepTarget?: ThreadRunGrepToolTarget;
  outputTruncated?: boolean;
  outputOriginalChars?: number;
  outputKeptChars?: number;
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
