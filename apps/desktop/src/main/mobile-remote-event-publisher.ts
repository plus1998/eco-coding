/**
 * EventCenter → remote delivery for V2 mobile clients.
 *
 * Conversation content is delivered by the durable V2 effect stream. The
 * retired thread projection/context/usage notifications are
 * intentionally dropped at this boundary so a remote client cannot rebuild a
 * feed from the V1 live projection wire.
 */
import type { EventCenterEnvelope, EventCenterJsonRpcNotification } from "../shared/event-center";

export const MOBILE_CONTEXT_USAGE_THROTTLE_MS = 8_000;
export const MAX_QUEUED_EVENTS = 100;

export interface MobileRemoteEventPublisherOptions {
  deliver: (notification: EventCenterJsonRpcNotification) => void;
  /** When false, notifications are dropped (or queued if queueWhenBlocked). Default true. */
  shouldDeliver?: () => boolean;
  /** When the transport is unavailable, buffer V2 notifications for a later flush. */
  queueWhenBlocked?: boolean;
  projectionExtrasThrottleMs?: number;
}

export class MobileRemoteEventPublisher {
  private readonly deliverFn: (notification: EventCenterJsonRpcNotification) => void;
  private readonly shouldDeliver: () => boolean;
  private readonly queueWhenBlocked: boolean;
  private readonly projectionExtrasThrottleMs: number;

  private readonly queuedEvents: EventCenterJsonRpcNotification[] = [];
  private readonly pendingProjectionExtras = new Map<
    string,
    { notification: EventCenterJsonRpcNotification; timer: ReturnType<typeof setTimeout> }
  >();

  constructor(options: MobileRemoteEventPublisherOptions) {
    this.deliverFn = options.deliver;
    this.shouldDeliver = options.shouldDeliver ?? (() => true);
    this.queueWhenBlocked = options.queueWhenBlocked ?? false;
    this.projectionExtrasThrottleMs =
      options.projectionExtrasThrottleMs ?? MOBILE_CONTEXT_USAGE_THROTTLE_MS;
  }

  publish(
    envelope: EventCenterEnvelope,
    notification: EventCenterJsonRpcNotification,
  ): void {
    // V1 projection and metrics notifications are no longer a remote protocol.
    if (
      envelope.kind === "thread.context" ||
      envelope.kind === "thread.usage"
    ) {
      return;
    }

    if (envelope.kind === "conversation.projection_extras") {
      const conversationId = envelope.threadId ?? readConversationId(envelope);
      if (!conversationId) {
        return;
      }
      const pending = this.pendingProjectionExtras.get(conversationId);
      if (pending) {
        pending.notification = notification;
        return;
      }
      const entry = {
        notification,
        timer: setTimeout(() => {
          const latest = this.pendingProjectionExtras.get(conversationId);
          this.pendingProjectionExtras.delete(conversationId);
          if (latest) {
            this.sendOrQueue(latest.notification);
          }
        }, this.projectionExtrasThrottleMs),
      };
      this.pendingProjectionExtras.set(conversationId, entry);
      return;
    }

    this.sendOrQueue(notification);
  }

  /** Flush buffered non-live deliveries after the transport becomes ready. */
  flushQueued(): void {
    for (const notification of this.queuedEvents.splice(0)) {
      this.deliverFn(notification);
    }
  }

  reset(): void {
    for (const pending of this.pendingProjectionExtras.values()) {
      clearTimeout(pending.timer);
    }
    this.pendingProjectionExtras.clear();
    this.queuedEvents.length = 0;
  }

  private sendOrQueue(notification: EventCenterJsonRpcNotification): void {
    if (this.shouldDeliver()) {
      this.deliverFn(notification);
      return;
    }

    if (!this.queueWhenBlocked) {
      return;
    }
    this.queuedEvents.push(notification);
    if (this.queuedEvents.length > MAX_QUEUED_EVENTS) {
      this.queuedEvents.shift();
    }
  }
}

function readConversationId(envelope: EventCenterEnvelope): string | undefined {
  const payload = envelope.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return undefined;
  }
  const value = (payload as { conversationId?: unknown }).conversationId;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
