import { parseReconnectActivityMessage, type ParsedReconnectActivity } from "./activity-display";

/** Who produced an activity/run-event line — used for feed dedupe, never inferred from message text in UI. */
export type ThreadActivityOrigin =
  | "proxy.connection_error"
  | "eco.auto_retry"
  | "eco.thread_blocked"
  | "eco.thread_failed"
  | "sdk.api_retry"
  | "sdk.upstream_error"
  | "sdk.run_failure";

export interface ThreadActivityRetryMetadata {
  attempt: number;
  maxRetries: number;
}

const ACTIVITY_ORIGIN_VALUES = new Set<string>([
  "proxy.connection_error",
  "eco.auto_retry",
  "eco.thread_blocked",
  "eco.thread_failed",
  "sdk.api_retry",
  "sdk.upstream_error",
  "sdk.run_failure",
]);

export function isThreadActivityOrigin(value: string): value is ThreadActivityOrigin {
  return ACTIVITY_ORIGIN_VALUES.has(value);
}

export function readThreadActivityOrigin(
  metadata: Record<string, unknown> | undefined,
): ThreadActivityOrigin | undefined {
  const raw = metadata?.activityOrigin;
  return typeof raw === "string" && isThreadActivityOrigin(raw) ? raw : undefined;
}

/** Resolve origin from explicit metadata, else map legacy liveType for persisted rows. */
export function resolveThreadActivityOrigin(input: {
  metadata?: Record<string, unknown> | undefined;
}): ThreadActivityOrigin | undefined {
  const explicit = readThreadActivityOrigin(input.metadata);
  if (explicit) {
    return explicit;
  }
  const liveType = input.metadata?.liveType;
  if (typeof liveType !== "string") {
    return undefined;
  }
  if (liveType === "thread.api_error") {
    return "proxy.connection_error";
  }
  if (liveType === "thread.auto_retry" || liveType === "thread.retry") {
    return "eco.auto_retry";
  }
  if (liveType === "thread.blocked") {
    return "eco.thread_blocked";
  }
  if (liveType === "thread.failed") {
    return "eco.thread_failed";
  }
  if (liveType === "request.retry_scheduled") {
    return "sdk.api_retry";
  }
  return undefined;
}

export function readThreadActivityRetryMetadata(
  metadata: Record<string, unknown> | undefined,
): ThreadActivityRetryMetadata | undefined {
  const raw = metadata?.retry;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return undefined;
  }
  const record = raw as Record<string, unknown>;
  const attempt = typeof record.attempt === "number" ? record.attempt : undefined;
  const maxRetries = typeof record.maxRetries === "number" ? record.maxRetries : undefined;
  if (attempt === undefined || maxRetries === undefined) {
    return undefined;
  }
  return { attempt, maxRetries };
}

export function isReconnectActivityOrigin(origin: ThreadActivityOrigin | undefined): boolean {
  return (
    origin === "proxy.connection_error" ||
    origin === "eco.auto_retry" ||
    origin === "sdk.api_retry"
  );
}

export function isRequestFailureFeedNoiseOrigin(origin: ThreadActivityOrigin | undefined): boolean {
  return (
    origin === "sdk.run_failure" ||
    origin === "eco.thread_blocked" ||
    origin === "eco.thread_failed"
  );
}

export function isUpstreamErrorPhaseOrigin(origin: ThreadActivityOrigin | undefined): boolean {
  return origin === "sdk.upstream_error";
}

export function isProxyConnectionFailureOrigin(origin: ThreadActivityOrigin | undefined): boolean {
  return origin === "proxy.connection_error";
}

export function resolveReconnectPhaseDisplay(input: {
  text: string;
  metadata?: Record<string, unknown> | undefined;
  apiError?: { statusCode?: number } | undefined;
}): ParsedReconnectActivity | null {
  const origin = resolveThreadActivityOrigin(input);
  if (origin === "proxy.connection_error") {
    if (input.apiError?.statusCode !== undefined) {
      return {
        summary: `连接失败 · HTTP ${input.apiError.statusCode}`,
        failed: true,
      };
    }
    return parseReconnectActivityMessage(input.text.trim());
  }
  if (origin === "eco.auto_retry" || origin === "sdk.api_retry") {
    const retry = readThreadActivityRetryMetadata(input.metadata);
    if (retry) {
      return {
        summary: `重连 ${retry.attempt}/${retry.maxRetries}`,
      };
    }
  }
  if (isReconnectActivityOrigin(origin)) {
    return null;
  }
  return parseReconnectActivityMessage(input.text.trim());
}
