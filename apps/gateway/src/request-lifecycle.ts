import { randomUUID } from "node:crypto";

import type {
  GatewayRequestLifecycleEvent,
  GatewayRequestLifecycleObserver,
  GatewayRequestLifecycleSource,
  ResolvedProviderRoute,
} from "./types.js";
import { readUpstreamRequestId } from "./upstream/request-id-headers.js";

type GatewayLogFn = (message: string) => void;

export type LogicalRequestTerminal = "completed" | "failed" | "cancelled";

export class RequestLifecycleTracker {
  private logicalTerminal: LogicalRequestTerminal | null = null;
  private upstreamFailedEmitted = false;
  private httpFailureEmitted = false;
  private upstreamStartedAtMs: number | null = null;
  private firstHeadersAtMs: number | null = null;
  private firstChunkAtMs: number | null = null;

  hasLogicalTerminal(): boolean {
    return this.logicalTerminal !== null;
  }

  hasUpstreamFailed(): boolean {
    return this.upstreamFailedEmitted;
  }

  tryMarkHttpFailure(): boolean {
    if (this.httpFailureEmitted) {
      return false;
    }
    this.httpFailureEmitted = true;
    return true;
  }

  tryMarkUpstreamFailed(): boolean {
    if (this.upstreamFailedEmitted) {
      return false;
    }
    this.upstreamFailedEmitted = true;
    return true;
  }

  trySetLogicalTerminal(terminal: LogicalRequestTerminal): boolean {
    if (this.logicalTerminal) {
      return false;
    }
    this.logicalTerminal = terminal;
    return true;
  }

  upstreamStartedAt(): number | null {
    return this.upstreamStartedAtMs;
  }

  firstHeadersAt(): number | null {
    return this.firstHeadersAtMs;
  }

  noteUpstreamStarted(atMs = Date.now()): void {
    if (this.upstreamStartedAtMs === null) {
      this.upstreamStartedAtMs = atMs;
    }
  }

  noteHeaders(atMs = Date.now()): void {
    if (this.firstHeadersAtMs === null) {
      this.firstHeadersAtMs = atMs;
    }
  }

  /** Record the first SSE data chunk of any kind (thinking, role, content — matches new-api FirstResponseTime). */
  noteFirstChunk(atMs = Date.now()): void {
    if (this.firstChunkAtMs === null) {
      this.firstChunkAtMs = atMs;
    }
  }

  /**
   * new-api style: TTFT = upstream start → first response chunk;
   * generationMs = stream end → first response chunk (fallback: total latency when no chunk).
   * Call at stream end / usage settlement with the end timestamp.
   */
  generationTiming(endAtMs = Date.now()): { ttftMs?: number; generationMs?: number } {
    const startedAtMs = this.upstreamStartedAtMs;
    if (startedAtMs === null) {
      return {};
    }
    const latencyMs = Math.max(0, endAtMs - startedAtMs);
    const firstAtMs = this.firstChunkAtMs;
    if (firstAtMs === null) {
      return { generationMs: latencyMs };
    }
    const ttftMs = Math.max(0, firstAtMs - startedAtMs);
    const generationMs = Math.max(0, endAtMs - firstAtMs);
    return { ttftMs, generationMs: generationMs > 0 ? generationMs : latencyMs };
  }

  private _attemptIndex = 0;

  nextAttemptIndex(): number {
    return this._attemptIndex++;
  }

  currentAttemptIndex(): number {
    return this._attemptIndex - 1;
  }
}

export interface RequestLifecycleContext {
  source: GatewayRequestLifecycleSource;
  route: ResolvedProviderRoute;
  onLog: GatewayLogFn;
  observer?: GatewayRequestLifecycleObserver;
  tracker: RequestLifecycleTracker;
  logicalRequestId: string;
  attemptIndex: number;
}

export function observeLifecycle(
  observer: GatewayRequestLifecycleObserver | undefined,
  event: GatewayRequestLifecycleEvent,
  onLog: GatewayLogFn,
): void {
  try {
    void Promise.resolve(observer?.(event)).catch((error) => {
      onLog(`request lifecycle observer failed: ${formatLifecycleError(error)}`);
    });
  } catch (error) {
    onLog(`request lifecycle observer failed: ${formatLifecycleError(error)}`);
  }
}

function lifecycleIdentity(ctx: RequestLifecycleContext): {
  source: GatewayRequestLifecycleSource;
  providerId: string;
  requestedModel: string;
  upstreamModelId: string;
  logicalRequestId: string;
  attemptIndex: number;
  observedAt: string;
  bridgeBindingId?: string;
  threadId?: string;
  runAttemptId?: string;
} {
  return {
    source: ctx.source,
    providerId: ctx.route.provider.id,
    requestedModel: ctx.route.requestedModel,
    upstreamModelId: ctx.route.upstreamModelId,
    logicalRequestId: ctx.logicalRequestId,
    attemptIndex: ctx.attemptIndex,
    observedAt: new Date().toISOString(),
    ...(ctx.route.bridgeBindingId ? { bridgeBindingId: ctx.route.bridgeBindingId } : {}),
    ...(ctx.route.threadId ? { threadId: ctx.route.threadId } : {}),
    ...(ctx.route.runAttemptId ? { runAttemptId: ctx.route.runAttemptId } : {}),
  };
}

export function tryEmitUpstreamFailed(
  ctx: RequestLifecycleContext | undefined,
  input: {
    stage: "transport" | "http" | "stream" | "protocol";
    error: string;
    statusCode?: number;
    providerRequestId?: string;
  },
): boolean {
  if (!ctx || !ctx.tracker.tryMarkUpstreamFailed()) {
    return false;
  }
  observeLifecycle(
    ctx.observer,
    {
      type: "upstream.failed",
      ...lifecycleIdentity(ctx),
      stage: input.stage,
      error: input.error,
      ...(input.statusCode !== undefined ? { statusCode: input.statusCode } : {}),
      ...(input.providerRequestId ? { providerRequestId: input.providerRequestId } : {}),
    },
    ctx.onLog,
  );
  return true;
}

/** Final HTTP non-2xx after retries — exactly one upstream.failed with stage=http. */
export function tryEmitHttpUpstreamFailure(
  ctx: RequestLifecycleContext | undefined,
  input: {
    error: string;
    statusCode: number;
    providerRequestId?: string;
  },
): boolean {
  if (!ctx || !ctx.tracker.tryMarkHttpFailure()) {
    return false;
  }
  return tryEmitUpstreamFailed(ctx, {
    stage: "http",
    error: input.error,
    statusCode: input.statusCode,
    ...(input.providerRequestId ? { providerRequestId: input.providerRequestId } : {}),
  });
}

export function tryEmitLogicalCompleted(
  ctx: RequestLifecycleContext | undefined,
  providerRequestId?: string,
): boolean {
  if (!ctx || !ctx.tracker.trySetLogicalTerminal("completed")) {
    return false;
  }
  const completedAtMs = Date.now();
  const startedAtMs = ctx.tracker.upstreamStartedAt();
  const headersAtMs = ctx.tracker.firstHeadersAt();
  if (startedAtMs !== null) {
    const upstreamMs = completedAtMs - startedAtMs;
    const ttfbMs = headersAtMs !== null ? headersAtMs - startedAtMs : undefined;
    const tokenTiming = ctx.tracker.generationTiming();
    ctx.onLog(
      `request lifecycle complete logical=${ctx.logicalRequestId} upstreamMs=${upstreamMs}` +
        `${ttfbMs !== undefined ? ` ttfbMs=${ttfbMs}` : ""}` +
        `${tokenTiming.ttftMs !== undefined ? ` ttftMs=${tokenTiming.ttftMs}` : ""}` +
        `${tokenTiming.generationMs !== undefined ? ` generationMs=${tokenTiming.generationMs}` : ""}` +
        `${providerRequestId ? ` provider=${providerRequestId}` : ""}`,
    );
  }
  observeLifecycle(
    ctx.observer,
    {
      type: "logical.completed",
      ...lifecycleIdentity(ctx),
      ...(providerRequestId ? { providerRequestId } : {}),
    },
    ctx.onLog,
  );
  return true;
}

export function tryEmitLogicalFailed(
  ctx: RequestLifecycleContext | undefined,
  input: {
    error: string;
    stage?: "transport" | "http" | "stream" | "protocol";
    statusCode?: number;
    providerRequestId?: string;
  },
): boolean {
  if (!ctx || !ctx.tracker.trySetLogicalTerminal("failed")) {
    return false;
  }
  observeLifecycle(
    ctx.observer,
    {
      type: "logical.failed",
      ...lifecycleIdentity(ctx),
      error: input.error,
      ...(input.stage ? { stage: input.stage } : {}),
      ...(input.statusCode !== undefined ? { statusCode: input.statusCode } : {}),
      ...(input.providerRequestId ? { providerRequestId: input.providerRequestId } : {}),
    },
    ctx.onLog,
  );
  return true;
}

export function tryEmitLogicalCancelled(
  ctx: RequestLifecycleContext | undefined,
  input?: { reason?: string; providerRequestId?: string },
): boolean {
  if (!ctx || !ctx.tracker.trySetLogicalTerminal("cancelled")) {
    return false;
  }
  observeLifecycle(
    ctx.observer,
    {
      type: "logical.cancelled",
      ...lifecycleIdentity(ctx),
      ...(input?.reason ? { reason: input.reason } : {}),
      ...(input?.providerRequestId ? { providerRequestId: input.providerRequestId } : {}),
    },
    ctx.onLog,
  );
  return true;
}

/** Report a terminal upstream failure (upstream.failed + logical.failed), each exactly once. */
export function reportLogicalUpstreamFailure(
  ctx: RequestLifecycleContext | undefined,
  input: {
    stage: "transport" | "http" | "stream" | "protocol";
    error: string;
    statusCode?: number;
    providerRequestId?: string;
  },
): void {
  if (input.stage === "http" && input.statusCode !== undefined) {
    tryEmitHttpUpstreamFailure(ctx, {
      error: input.error,
      statusCode: input.statusCode,
      ...(input.providerRequestId ? { providerRequestId: input.providerRequestId } : {}),
    });
  } else {
    tryEmitUpstreamFailed(ctx, input);
  }
  tryEmitLogicalFailed(ctx, {
    error: input.error,
    stage: input.stage,
    ...(input.statusCode !== undefined ? { statusCode: input.statusCode } : {}),
    ...(input.providerRequestId ? { providerRequestId: input.providerRequestId } : {}),
  });
}

/** Real upstream fetch: started/headers only; transport errors are terminal failures. */
export async function fetchWithRequestLifecycle(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  ctx: RequestLifecycleContext,
): Promise<Response> {
  ctx.attemptIndex = ctx.tracker.nextAttemptIndex();
  ctx.tracker.noteUpstreamStarted();
  observeLifecycle(
    ctx.observer,
    {
      type: "upstream.started",
      ...lifecycleIdentity(ctx),
    },
    ctx.onLog,
  );
  let response: Response;
  try {
    response = await fetchImpl(url, init);
  } catch (error) {
    // Do not mark logical failure here — callers / fetchUpstreamWithRetry may retry.
    throw error;
  }
  const providerRequestId = readUpstreamRequestId(response.headers);
  ctx.tracker.noteHeaders();
  observeLifecycle(
    ctx.observer,
    {
      type: "upstream.headers",
      ...lifecycleIdentity(ctx),
      statusCode: response.status,
      ...(providerRequestId ? { providerRequestId } : {}),
    },
    ctx.onLog,
  );
  return response;
}

function formatLifecycleError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function buildRequestLifecycleContext(
  route: ResolvedProviderRoute,
  source: GatewayRequestLifecycleSource,
  onLog: GatewayLogFn,
  observer?: GatewayRequestLifecycleObserver,
): RequestLifecycleContext | undefined {
  if (!observer) {
    return undefined;
  }
  const logicalRequestId = route.logicalRequestId || `glr_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
  return {
    source,
    route,
    onLog,
    observer,
    tracker: new RequestLifecycleTracker(),
    logicalRequestId,
    attemptIndex: 0,
  };
}
