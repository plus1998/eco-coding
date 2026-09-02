/**
 * Throttled EventCenter → remote delivery (projection / context / usage).
 *
 * Shared by Supabase Realtime bind fan-out and the legacy WS client tests.
 */
import type { EventCenterEnvelope, EventCenterJsonRpcNotification } from "../shared/event-center";
import type { ThreadLiveEvent, ThreadRunProjectionSnapshot } from "../shared/ipc";
import { trimProjectionForRemoteWire } from "./thread-run-projection-feed";

export const MOBILE_STREAMING_PROJECTION_THROTTLE_MS = 5_000;
export const MOBILE_CONTEXT_USAGE_THROTTLE_MS = 8_000;
export const MAX_QUEUED_NON_PROJECTION_EVENTS = 100;

interface MobileProjectionAgentBatch {
  agent: ThreadRunProjectionSnapshot["agents"][number];
  timelineById: Map<string, ThreadRunProjectionSnapshot["timeline"][number]>;
}

interface MobileProjectionBatch {
  projection: ThreadRunProjectionSnapshot;
  attemptsById: Map<string, ThreadRunProjectionSnapshot["attempts"][number]>;
  requestSpansById: Map<string, ThreadRunProjectionSnapshot["requestSpans"][number]>;
  timelineById: Map<string, ThreadRunProjectionSnapshot["timeline"][number]>;
  agentsById: Map<string, MobileProjectionAgentBatch>;
}

interface PendingMobileProjection {
  notification: EventCenterJsonRpcNotification;
  batch: MobileProjectionBatch;
  timer: ReturnType<typeof setTimeout>;
}

interface QueuedMobileProjection {
  notification: EventCenterJsonRpcNotification;
  batch: MobileProjectionBatch;
}

export interface MobileRemoteEventPublisherOptions {
  deliver: (notification: EventCenterJsonRpcNotification) => void;
  /** When false, notifications are dropped (or queued if queueWhenBlocked). Default true. */
  shouldDeliver?: () => boolean;
  /**
   * When shouldDeliver is false, buffer projections/events for later flush.
   * Used by the legacy WS client while the socket is down but mobiles are online.
   */
  queueWhenBlocked?: boolean;
  streamingProjectionThrottleMs?: number;
  contextUsageThrottleMs?: number;
}

export class MobileRemoteEventPublisher {
  private readonly deliverFn: (notification: EventCenterJsonRpcNotification) => void;
  private readonly shouldDeliver: () => boolean;
  private readonly queueWhenBlocked: boolean;
  private readonly streamingProjectionThrottleMs: number;
  private readonly contextUsageThrottleMs: number;

  private readonly queuedEvents: EventCenterJsonRpcNotification[] = [];
  private readonly queuedMobileProjections = new Map<string, QueuedMobileProjection>();
  private readonly pendingMobileProjections = new Map<string, PendingMobileProjection>();
  private readonly pendingContextUsage = new Map<
    string,
    { notification: EventCenterJsonRpcNotification; timer: ReturnType<typeof setTimeout> }
  >();

  constructor(options: MobileRemoteEventPublisherOptions) {
    this.deliverFn = options.deliver;
    this.shouldDeliver = options.shouldDeliver ?? (() => true);
    this.queueWhenBlocked = options.queueWhenBlocked ?? false;
    this.streamingProjectionThrottleMs =
      options.streamingProjectionThrottleMs ?? MOBILE_STREAMING_PROJECTION_THROTTLE_MS;
    this.contextUsageThrottleMs = options.contextUsageThrottleMs ?? MOBILE_CONTEXT_USAGE_THROTTLE_MS;
  }

  publish(envelope: EventCenterEnvelope, notification: EventCenterJsonRpcNotification): void {
    const threadEvent = readThreadLiveEvent(envelope);
    if (threadEvent && isRemoteOnlyStreamDelta(threadEvent)) {
      return;
    }

    if (envelope.kind === "thread.projection" && threadEvent?.projection) {
      this.publishMobileProjection(envelope, notification, threadEvent);
      return;
    }

    if (envelope.kind === "thread.context" || envelope.kind === "thread.usage") {
      const throttleKey = `${envelope.kind}:${envelope.threadId ?? threadEvent?.threadId ?? "global"}`;
      this.publishThrottledNonProjection(throttleKey, notification);
      return;
    }

    const threadId = envelope.threadId ?? threadEvent?.threadId;
    if (threadId && shouldFlushProjectionBeforeEvent(envelope.kind, threadEvent)) {
      this.flushPendingMobileProjection(threadId);
    }
    this.sendOrQueue(notification);
  }

  /** Flush buffered non-live deliveries after the transport becomes ready. */
  flushQueued(): void {
    for (const notification of this.queuedEvents.splice(0)) {
      this.deliverFn(notification);
    }
    for (const [threadId, queued] of this.queuedMobileProjections) {
      this.deliverFn(
        replaceProjectionNotification(
          queued.notification,
          prepareMobileWireProjection(materializeMobileProjectionBatch(queued.batch), false),
        ),
      );
      this.queuedMobileProjections.delete(threadId);
    }
  }

  reset(): void {
    this.clearPendingMobileProjections();
    this.clearPendingContextUsage();
    this.queuedMobileProjections.clear();
    this.queuedEvents.length = 0;
  }

  private publishMobileProjection(
    envelope: EventCenterEnvelope,
    notification: EventCenterJsonRpcNotification,
    event: ThreadLiveEvent,
  ): void {
    const threadId = envelope.threadId ?? event.threadId;
    const projection = event.projection;
    if (!threadId || !projection) {
      this.sendOrQueue(notification);
      return;
    }

    const pending = this.pendingMobileProjections.get(threadId);
    if (!isStreamingProjection(projection)) {
      if (pending) {
        clearTimeout(pending.timer);
        this.pendingMobileProjections.delete(threadId);
        this.sendOrQueue(
          replaceProjectionNotification(
            notification,
            prepareMobileWireProjection(
              materializeMobileProjectionBatch(appendMobileProjectionBatch(pending.batch, projection)),
              false,
            ),
          ),
        );
      } else {
        this.sendOrQueue(
          replaceProjectionNotification(notification, prepareMobileWireProjection(projection, false)),
        );
      }
      return;
    }

    if (pending) {
      pending.notification = notification;
      pending.batch = appendMobileProjectionBatch(pending.batch, projection);
      return;
    }

    const entry: PendingMobileProjection = {
      notification,
      batch: createMobileProjectionBatch(projection),
      timer: setTimeout(() => {
        const latest = this.pendingMobileProjections.get(threadId);
        if (!latest) return;
        this.pendingMobileProjections.delete(threadId);
        this.sendOrQueue(
          replaceProjectionNotification(
            latest.notification,
            prepareMobileWireProjection(materializeMobileProjectionBatch(latest.batch), true),
          ),
        );
      }, this.streamingProjectionThrottleMs),
    };
    this.pendingMobileProjections.set(threadId, entry);
  }

  private flushPendingMobileProjection(threadId: string): void {
    const pending = this.pendingMobileProjections.get(threadId);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pendingMobileProjections.delete(threadId);
    this.sendOrQueue(
      replaceProjectionNotification(
        pending.notification,
        prepareMobileWireProjection(materializeMobileProjectionBatch(pending.batch), true),
      ),
    );
  }

  private publishThrottledNonProjection(key: string, notification: EventCenterJsonRpcNotification): void {
    const existing = this.pendingContextUsage.get(key);
    if (existing) {
      existing.notification = notification;
      return;
    }
    const entry = {
      notification,
      timer: setTimeout(() => {
        const latest = this.pendingContextUsage.get(key);
        this.pendingContextUsage.delete(key);
        if (latest) {
          this.sendOrQueue(latest.notification);
        }
      }, this.contextUsageThrottleMs),
    };
    this.pendingContextUsage.set(key, entry);
  }

  private clearPendingContextUsage(): void {
    for (const pending of this.pendingContextUsage.values()) {
      clearTimeout(pending.timer);
    }
    this.pendingContextUsage.clear();
  }

  private clearPendingMobileProjections(): void {
    for (const pending of this.pendingMobileProjections.values()) {
      clearTimeout(pending.timer);
    }
    this.pendingMobileProjections.clear();
  }

  private sendOrQueue(notification: EventCenterJsonRpcNotification): void {
    if (this.shouldDeliver()) {
      this.deliverFn(notification);
      return;
    }

    if (!this.queueWhenBlocked) {
      return;
    }

    const projectionEntry = readProjectionNotification(notification);
    if (projectionEntry) {
      const queued = this.queuedMobileProjections.get(projectionEntry.threadId);
      if (queued) {
        queued.notification = notification;
        queued.batch = appendMobileProjectionBatch(queued.batch, projectionEntry.projection);
      } else {
        this.queuedMobileProjections.set(projectionEntry.threadId, {
          notification,
          batch: createMobileProjectionBatch(projectionEntry.projection),
        });
      }
      return;
    }

    this.queuedEvents.push(notification);
    if (this.queuedEvents.length > MAX_QUEUED_NON_PROJECTION_EVENTS) {
      this.queuedEvents.shift();
    }
  }
}

export function readThreadLiveEvent(envelope: EventCenterEnvelope): ThreadLiveEvent | undefined {
  if (!envelope.kind.startsWith("thread.")) {
    return undefined;
  }
  return isRecord(envelope.payload) ? (envelope.payload as unknown as ThreadLiveEvent) : undefined;
}

function isRemoteOnlyStreamDelta(event: ThreadLiveEvent): boolean {
  return event.stream === true && (event.type === "message.delta" || event.type === "thinking.delta");
}

function shouldFlushProjectionBeforeEvent(
  kind: EventCenterEnvelope["kind"],
  event: ThreadLiveEvent | undefined,
): boolean {
  if (kind === "thread.stream") {
    return event?.stream === false;
  }
  return (
    kind === "thread.lifecycle" ||
    kind === "thread.plan" ||
    kind === "thread.clarification" ||
    kind === "thread.bash_approval" ||
    kind === "thread.follow_up" ||
    kind === "thread.todo"
  );
}

function isStreamingProjection(projection: ThreadRunProjectionSnapshot): boolean {
  return (
    projection.timeline.some(
      (item) => item.eventType === "message.delta" || item.eventType === "thinking.delta",
    ) ||
    projection.agents.some((agent) =>
      agent.timeline.some(
        (item) => item.eventType === "message.delta" || item.eventType === "thinking.delta",
      ),
    )
  );
}

function createMobileProjectionBatch(projection: ThreadRunProjectionSnapshot): MobileProjectionBatch {
  return {
    projection,
    attemptsById: new Map(projection.attempts.map((attempt) => [attempt.attemptId, attempt])),
    requestSpansById: new Map(projection.requestSpans.map((span) => [span.requestId, span])),
    timelineById: new Map(projection.timeline.map((item) => [item.id, item])),
    agentsById: new Map(
      projection.agents.map((agent) => [
        agent.agentId,
        {
          agent,
          timelineById: new Map(agent.timeline.map((item) => [item.id, item])),
        },
      ]),
    ),
  };
}

function appendMobileProjectionBatch(
  current: MobileProjectionBatch,
  incoming: ThreadRunProjectionSnapshot,
): MobileProjectionBatch {
  const currentRevision = projectionHistoryRevision(current);
  const incomingRevision = projectionHistoryRevision(incoming);
  if (incomingRevision !== currentRevision) {
    return incomingRevision > currentRevision ? createMobileProjectionBatch(incoming) : current;
  }

  const sourceEventCount = Math.max(current.projection.sourceEventCount, incoming.sourceEventCount);
  current.projection = { ...incoming, sourceEventCount };
  mergeProjectionRecordsInto(current.attemptsById, incoming.attempts, (attempt) => attempt.attemptId);
  mergeProjectionRecordsInto(current.requestSpansById, incoming.requestSpans, (span) => span.requestId);
  mergeProjectionRecordsInto(current.timelineById, incoming.timeline, (item) => item.id);
  for (const agent of incoming.agents) {
    const existing = current.agentsById.get(agent.agentId);
    if (existing) {
      existing.agent = agent;
      mergeProjectionRecordsInto(existing.timelineById, agent.timeline, (item) => item.id);
    } else {
      current.agentsById.set(agent.agentId, {
        agent,
        timelineById: new Map(agent.timeline.map((item) => [item.id, item])),
      });
    }
  }
  return current;
}

function materializeMobileProjectionBatch(batch: MobileProjectionBatch): ThreadRunProjectionSnapshot {
  return {
    ...batch.projection,
    attempts: [...batch.attemptsById.values()],
    requestSpans: [...batch.requestSpansById.values()],
    timeline: sortProjectionTimeline([...batch.timelineById.values()]),
    agents: [...batch.agentsById.values()].map(({ agent, timelineById }) => ({
      ...agent,
      timeline: sortProjectionTimeline([...timelineById.values()]),
    })),
  };
}

function prepareMobileWireProjection(
  projection: ThreadRunProjectionSnapshot,
  streaming: boolean,
): ThreadRunProjectionSnapshot {
  return trimProjectionForRemoteWire(projection, { streaming });
}

function projectionHistoryRevision(projection: ThreadRunProjectionSnapshot | MobileProjectionBatch): number {
  const revision =
    "projection" in projection ? projection.projection.historyRevision : projection.historyRevision;
  return typeof revision === "number" && Number.isFinite(revision) ? revision : 0;
}

function sortProjectionTimeline(
  timeline: ThreadRunProjectionSnapshot["timeline"],
): ThreadRunProjectionSnapshot["timeline"] {
  timeline.sort((left, right) => {
    const sequenceDiff = left.sequence - right.sequence;
    if (sequenceDiff !== 0) return sequenceDiff;
    const timeDiff = left.at.localeCompare(right.at);
    return timeDiff !== 0 ? timeDiff : left.id.localeCompare(right.id);
  });
  return timeline;
}

function mergeProjectionRecordsInto<T>(
  current: Map<string, T>,
  incoming: readonly T[],
  readId: (item: T) => string,
): void {
  for (const item of incoming) {
    current.set(readId(item), item);
  }
}

function replaceProjectionNotification(
  notification: EventCenterJsonRpcNotification,
  projection: ThreadRunProjectionSnapshot,
): EventCenterJsonRpcNotification {
  const envelope = notification.params as EventCenterEnvelope<ThreadLiveEvent>;
  return {
    ...notification,
    params: {
      ...envelope,
      payload: {
        ...envelope.payload,
        projection,
      },
    },
  };
}

function readProjectionNotification(
  notification: EventCenterJsonRpcNotification,
): { threadId: string; projection: ThreadRunProjectionSnapshot } | undefined {
  const envelope = notification.params as EventCenterEnvelope;
  if (envelope.kind !== "thread.projection") return undefined;
  const event = readThreadLiveEvent(envelope);
  const threadId = envelope.threadId ?? event?.threadId;
  if (!threadId || !event?.projection) return undefined;
  return { threadId, projection: event.projection };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
