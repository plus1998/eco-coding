import type { ThreadRunEventScope, ThreadRunEventType } from "./thread-run-events";

export type ThreadRunProjectionAgentKind = "planner" | "subagent";

export type ThreadRunProjectionAgentStatus = "launching" | "active" | "stopped" | "abandoned";

export type ThreadRunProjectionAttemptStatus = "running" | "completed" | "failed" | "cancelled";

export type ThreadRunProjectionRequestStatus =
  | "waiting_first_token"
  | "streaming"
  | "completed"
  | "failed"
  | "cancelled";

export type ThreadRunProjectionDiagnosticCode =
  | "missing_agent_id"
  | "ambiguous_subagent_role"
  | "orphan_stream_finalize"
  | "negative_duration"
  | "request_span_left_open";

export interface ThreadRunProjectionUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  ecoCostUsd: number;
  modelId?: string;
}

export interface ThreadRunProjectionContext {
  occupied: number;
  limit: number;
  occupancyPct: number;
  modelId?: string;
}

export interface ThreadRunProjectionTimelineItem {
  id: string;
  /** Timeline order and incremental sync version; newer versions replace the same id on clients. */
  sequence: number;
  eventType: ThreadRunEventType;
  scope: ThreadRunEventScope;
  role?: string;
  agentId?: string;
  runAttemptId?: string;
  requestId?: string;
  streamKey?: string;
  text: string;
  at: string;
  metadata?: Record<string, unknown>;
}

export interface ThreadRunProjectionAttempt {
  attemptId: string;
  phase: string;
  retryIndex: number;
  status: ThreadRunProjectionAttemptStatus;
  startedAt: string;
  endedAt?: string;
}

export interface ThreadRunProjectionAgent {
  agentId: string;
  role: string;
  kind: ThreadRunProjectionAgentKind;
  status: ThreadRunProjectionAgentStatus;
  startedAt: string;
  durationMs: number;
  runAttemptId?: string;
  parentAgentId?: string;
  parentToolUseId?: string;
  mission?: string;
  delegationSummary?: string;
  delegationPrompt?: string;
  todoId?: string;
  endedAt?: string;
  latestActivity?: string;
  usage?: ThreadRunProjectionUsage;
  context?: ThreadRunProjectionContext;
  timeline: ThreadRunProjectionTimelineItem[];
}

export interface ThreadRunProjectionRequestSpan {
  requestId: string;
  ownerAgentId?: string;
  role?: string;
  source?: string;
  status: ThreadRunProjectionRequestStatus;
  startedAt: string;
  firstTokenAt?: string;
  endedAt?: string;
  error?: string;
}

export interface ThreadRunProjectionDiagnostic {
  code: ThreadRunProjectionDiagnosticCode;
  message: string;
  eventId?: string;
  agentId?: string;
  requestId?: string;
}

export interface ThreadRunProjectionSnapshot {
  thread: {
    threadId: string;
    status: string;
    generatedAt: string;
    message?: string;
    currentAttemptId?: string;
  };
  attempts: ThreadRunProjectionAttempt[];
  agents: ThreadRunProjectionAgent[];
  requestSpans: ThreadRunProjectionRequestSpan[];
  timeline: ThreadRunProjectionTimelineItem[];
  diagnostics: ThreadRunProjectionDiagnostic[];
  sourceEventCount: number;
  /** Increments when the conversation history is intentionally rewound. */
  historyRevision?: number;
}

export type ThreadRunProjectionDetailKind = "agent" | "tool";

export interface ThreadRunProjectionDetailRequest {
  threadId: string;
  kind: ThreadRunProjectionDetailKind;
  key: string;
  afterSequence?: number;
  beforeSequence?: number;
  /** Return the newest page when no forward cursor is supplied. */
  tail?: boolean;
  limit?: number;
}

export interface ThreadRunProjectionDetailResult {
  threadId: string;
  kind: ThreadRunProjectionDetailKind;
  key: string;
  generatedAt: string;
  timeline: ThreadRunProjectionTimelineItem[];
  sourceEventCount: number;
  agent?: ThreadRunProjectionAgent;
  hasMore: boolean;
  nextAfterSequence?: number;
  hasEarlier?: boolean;
  previousBeforeSequence?: number;
}
