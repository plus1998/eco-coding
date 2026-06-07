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
  | "message.delta"
  | "message.final"
  | "thinking.delta"
  | "thinking.final"
  | "tool.started"
  | "tool.completed"
  | "tool.failed"
  | "api.error"
  | "diagnostic";

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
