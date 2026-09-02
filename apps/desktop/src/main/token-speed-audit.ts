import type { GatewayRequestLifecycleEvent } from "@eco/gateway";

import type { ThreadRunProjectionRequestSpan } from "../shared/thread-run-projection";
import { computeRequestSpanTtftMs } from "../shared/request-span-timing";
import { formatTokenSpeedStats } from "../renderer/token-speed";
import { logEcoDiag, shortThreadId } from "./eco-diag-log";

interface GatewayRequestTiming {
  threadId: string;
  logicalRequestId: string;
  role?: string;
  upstreamStartedAt?: string;
  headersAt?: string;
  completedAt?: string;
  providerRequestId?: string;
}

const gatewayTimingsByLogicalId = new Map<string, GatewayRequestTiming>();
const gatewayTimingsByProviderId = new Map<string, GatewayRequestTiming>();

function timingKey(threadId: string, id: string): string {
  return threadId ? `${threadId}::${id}` : `::logical::${id}`;
}

function providerTimingKey(threadId: string, providerRequestId: string): string {
  return threadId ? timingKey(threadId, providerRequestId) : `::provider::${providerRequestId}`;
}

export function clearTokenSpeedAuditStateForTests(): void {
  gatewayTimingsByLogicalId.clear();
  gatewayTimingsByProviderId.clear();
}

export function lookupGatewayGenerationMs(
  threadId: string,
  ids: { logicalRequestId?: string; providerRequestId?: string },
  usageObservedAt?: string,
): number | undefined {
  const providerRequestId = ids.providerRequestId?.trim();
  if (providerRequestId) {
    for (const key of [providerTimingKey(threadId, providerRequestId), `::provider::${providerRequestId}`]) {
      const byProvider = gatewayTimingsByProviderId.get(key);
      const ms = deltaMs(byProvider?.upstreamStartedAt, byProvider?.completedAt);
      if (ms !== undefined) {
        return ms;
      }
    }
  }
  const logicalRequestId = ids.logicalRequestId?.trim();
  if (logicalRequestId) {
    for (const key of [timingKey(threadId, logicalRequestId), `::logical::${logicalRequestId}`]) {
      const byLogical = gatewayTimingsByLogicalId.get(key);
      const ms =
        deltaMs(byLogical?.upstreamStartedAt, byLogical?.completedAt) ??
        deltaMs(byLogical?.upstreamStartedAt, usageObservedAt);
      if (ms !== undefined) {
        return ms;
      }
    }
  }
  return undefined;
}

export function recordGatewayRequestLifecycleTiming(
  threadId: string,
  event: GatewayRequestLifecycleEvent,
): void {
  const logicalRequestId = event.logicalRequestId?.trim();
  if (!logicalRequestId) {
    return;
  }
  const logicalKeys = [
    timingKey(threadId, logicalRequestId),
    ...(threadId ? [] : [`::logical::${logicalRequestId}`]),
  ];
  const row =
    logicalKeys.map((key) => gatewayTimingsByLogicalId.get(key)).find(Boolean) ??
    ({ threadId, logicalRequestId } satisfies GatewayRequestTiming);
  if (event.type === "upstream.started") {
    row.upstreamStartedAt = event.observedAt;
  } else if (event.type === "upstream.headers") {
    row.headersAt = event.observedAt;
    if (event.providerRequestId) {
      row.providerRequestId = event.providerRequestId;
    }
  } else if (event.type === "logical.completed") {
    row.completedAt = event.observedAt;
    if (event.providerRequestId) {
      row.providerRequestId = event.providerRequestId;
    }
  }
  for (const key of logicalKeys) {
    gatewayTimingsByLogicalId.set(key, row);
  }
  const providerRequestId = row.providerRequestId?.trim() ?? event.providerRequestId?.trim();
  if (providerRequestId) {
    for (const key of [providerTimingKey(threadId, providerRequestId), `::provider::${providerRequestId}`]) {
      gatewayTimingsByProviderId.set(key, row);
    }
  }
}

function parseMs(iso: string | undefined): number | undefined {
  if (!iso) {
    return undefined;
  }
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : undefined;
}

function deltaMs(from: string | undefined, to: string | undefined): number | undefined {
  const fromMs = parseMs(from);
  const toMs = parseMs(to);
  if (fromMs === undefined || toMs === undefined) {
    return undefined;
  }
  return Math.max(0, toMs - fromMs);
}

function shortRequestId(id: string): string {
  return id.length > 20 ? id.slice(-20) : id;
}

/**
 * Compare Feed request-span timing with gateway lifecycle timestamps and emit
 * structured diagnostics when windows disagree (e.g. request.completed after tools).
 */
export function auditTokenSpeedRequestSpan(
  threadId: string,
  span: ThreadRunProjectionRequestSpan,
  streamedText = "",
): void {
  const decodeEndAt = span.streamingEndedAt ?? span.endedAt;
  const stats = formatTokenSpeedStats(
    {
      status: span.status,
      startedAt: span.startedAt,
      ...(span.firstTokenAt && { firstTokenAt: span.firstTokenAt }),
      ...(decodeEndAt && { endedAt: decodeEndAt }),
      ...(span.outputTokens !== undefined && { outputTokens: span.outputTokens }),
    },
    streamedText,
  );
  const gateway = gatewayTimingsByLogicalId.get(timingKey(threadId, span.requestId));
  const ttftMs = computeRequestSpanTtftMs({
    status: span.firstTokenAt ? "streaming" : span.status,
    startedAt: span.startedAt,
    ...(span.firstTokenAt && { firstTokenAt: span.firstTokenAt }),
  });
  const feedLifecycleMs = deltaMs(span.startedAt, span.endedAt);
  const feedDecodeMs = deltaMs(span.firstTokenAt, decodeEndAt);
  const gatewayUpstreamMs = gateway ? deltaMs(gateway.upstreamStartedAt, gateway.completedAt) : undefined;
  const gatewayTtfbMs = gateway ? deltaMs(gateway.upstreamStartedAt, gateway.headersAt) : undefined;
  const gatewayVsStreamSkewMs =
    gateway?.completedAt && decodeEndAt ? deltaMs(decodeEndAt, gateway.completedAt) : undefined;

  const suspicious =
    (gatewayVsStreamSkewMs !== undefined && Math.abs(gatewayVsStreamSkewMs) > 500) ||
    (gatewayUpstreamMs !== undefined &&
      feedDecodeMs !== undefined &&
      ttftMs !== undefined &&
      gatewayUpstreamMs > feedDecodeMs + ttftMs + 750);

  if (!suspicious && span.status !== "completed") {
    return;
  }

  logEcoDiag("token_speed.audit", {
    threadId: shortThreadId(threadId),
    requestId: shortRequestId(span.requestId),
    ...(span.role && { role: span.role }),
    ...(span.providerRequestId && { providerRequestId: shortRequestId(span.providerRequestId) }),
    status: span.status,
    startedAt: span.startedAt,
    ...(span.firstTokenAt && { firstTokenAt: span.firstTokenAt }),
    ...(decodeEndAt && { streamingEndedAt: decodeEndAt }),
    ...(span.endedAt && span.endedAt !== decodeEndAt && { lifecycleEndedAt: span.endedAt }),
    ...(ttftMs !== undefined && { ttftMs }),
    ...(stats.rateTps !== undefined && { feedRateTps: Math.round(stats.rateTps * 10) / 10 }),
    ...(stats.streamedTokens > 0 && { streamedTokens: stats.streamedTokens, tokenSource: stats.tokenSource }),
    ...(feedLifecycleMs !== undefined && { feedLifecycleMs }),
    ...(feedDecodeMs !== undefined && { feedDecodeMs }),
    ...(gatewayVsStreamSkewMs !== undefined &&
      gatewayVsStreamSkewMs !== 0 && { gatewayVsStreamSkewMs }),
    ...(gateway?.upstreamStartedAt && { gatewayStartedAt: gateway.upstreamStartedAt }),
    ...(gateway?.headersAt && { gatewayHeadersAt: gateway.headersAt }),
    ...(gateway?.completedAt && { gatewayCompletedAt: gateway.completedAt }),
    ...(gatewayTtfbMs !== undefined && { gatewayTtfbMs }),
    ...(gatewayUpstreamMs !== undefined && { gatewayUpstreamMs }),
    suspicious,
  });

  if (gateway && span.status === "completed") {
    for (const key of [timingKey(threadId, span.requestId), `::logical::${span.requestId}`]) {
      gatewayTimingsByLogicalId.delete(key);
    }
    const providerRequestId = gateway.providerRequestId?.trim();
    if (providerRequestId) {
      for (const key of [providerTimingKey(threadId, providerRequestId), `::provider::${providerRequestId}`]) {
        gatewayTimingsByProviderId.delete(key);
      }
    }
  }
}

export function auditTokenSpeedRequestSpans(
  threadId: string,
  spans: readonly ThreadRunProjectionRequestSpan[],
): void {
  for (const span of spans) {
    if (span.status === "completed" || span.status === "failed" || span.status === "cancelled") {
      auditTokenSpeedRequestSpan(threadId, span);
    }
  }
}
