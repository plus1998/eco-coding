import type { ThreadRunProjectionRequestSpan } from "../shared/thread-run-projection";
import { estimateTextTokens } from "../shared/token-estimate";
import { resolveRateNumeratorTokens } from "../shared/request-span-usage";

export type TokenSpeedTokenSource = "usage" | "estimate";

export interface TokenSpeedStats {
  /** True while the request span is still open (waiting or streaming). */
  active: boolean;
  /** Elapsed ms while waiting for the first token (live). */
  waitingMs?: number;
  /** Time to first token in ms; undefined until the first token arrives. */
  ttftMs?: number;
  /**
   * Decode rate in tokens per second (Cherry-style: tokens after TTFT).
   * Only set after the request span closes — live estimates over partial windows are withheld.
   */
  rateTps?: number;
  /** Tokens used for the rate numerator. */
  streamedTokens: number;
  /** Whether `streamedTokens` / `rateTps` came from provider usage or a local heuristic. */
  tokenSource: TokenSpeedTokenSource;
}

export {
  attachOutputTokensToRequestSpans,
  dedupeUsageLedgerRowsForSpanJoin,
  type RequestSpanLedgerUsageRow as TokenSpeedLedgerUsageRow,
  resolveRateNumeratorTokens,
} from "../shared/request-span-usage";

export function isTokenSpeedSpanActive(span: ThreadRunProjectionRequestSpan): boolean {
  return span.status === "waiting_first_token" || span.status === "streaming";
}

/** Cherry-style: badge attaches to narrative items; span role may still be `thinking` on Codex. */
export function isTokenSpeedEligibleSpan(_span: ThreadRunProjectionRequestSpan): boolean {
  return true;
}

/**
 * Resolve the request span that produced a timeline item without relying on an exact
 * `requestId` match. Some runtimes (e.g. PI/ACP driver channels) do not propagate a
 * matching `requestId` onto the streamed narrative item, so the exact lookup misses.
 *
 * Fallback: pick the most recent span whose `startedAt` is at or before the item's
 * timestamp, preferring a span whose role/agent matches the item. Returns undefined
 * when there are no spans or the item has no parseable timestamp.
 */
export function resolveLenientRequestSpan(
  item: { at: string; role?: string; agentId?: string },
  spans: readonly ThreadRunProjectionRequestSpan[],
): ThreadRunProjectionRequestSpan | undefined {
  if (spans.length === 0) {
    return undefined;
  }
  const itemAt = Date.parse(item.at);
  if (!Number.isFinite(itemAt)) {
    return undefined;
  }

  let sameRole: ThreadRunProjectionRequestSpan | undefined;
  let mostRecent: ThreadRunProjectionRequestSpan | undefined;
  let sameRoleAt = -Infinity;
  let mostRecentAt = -Infinity;

  for (const span of spans) {
    const startedAt = Date.parse(span.startedAt);
    if (!Number.isFinite(startedAt) || startedAt > itemAt) {
      continue;
    }
    if (startedAt > mostRecentAt) {
      mostRecentAt = startedAt;
      mostRecent = span;
    }
    const roleMatches = item.role
      ? span.role === item.role
      : span.ownerAgentId
        ? span.ownerAgentId === item.agentId
        : true;
    if (roleMatches && startedAt > sameRoleAt) {
      sameRoleAt = startedAt;
      sameRole = span;
    }
  }
  return sameRole ?? mostRecent;
}

export function formatTokenSpeedStats(
  span: Pick<
    ThreadRunProjectionRequestSpan,
    | "status"
    | "startedAt"
    | "firstTokenAt"
    | "outputTokens"
    | "reasoningTokens"
    | "ttftMs"
    | "generationMs"
  >,
  streamedText: string,
  nowMs = Date.now(),
): TokenSpeedStats {
  const estimatedTokens = estimateTextTokens(streamedText);
  const rateNumerator = resolveRateNumeratorTokens({
    span,
    estimatedTokens,
  });
  const totalOutput =
    typeof span.outputTokens === "number" && Number.isFinite(span.outputTokens) && span.outputTokens > 0
      ? Math.floor(span.outputTokens)
      : undefined;
  const tokenSource: TokenSpeedTokenSource = rateNumerator.tokenSource;
  const streamedTokens = totalOutput ?? estimatedTokens;

  const startedMs = Date.parse(span.startedAt);
  if (!Number.isFinite(startedMs)) {
    return {
      active: isTokenSpeedSpanActive(span as ThreadRunProjectionRequestSpan),
      streamedTokens,
      tokenSource,
    };
  }

  const active = isTokenSpeedSpanActive(span as ThreadRunProjectionRequestSpan);
  if (!span.firstTokenAt) {
    if (!active) {
      return { active: false, streamedTokens, tokenSource };
    }
    return {
      active: true,
      waitingMs: Math.max(0, nowMs - startedMs),
      streamedTokens,
      tokenSource,
    };
  }

  const firstTokenMs = Date.parse(span.firstTokenAt);
  if (!Number.isFinite(firstTokenMs)) {
    return { active, streamedTokens, tokenSource };
  }
  const ttftMs = Math.max(0, firstTokenMs - startedMs);
  // Live tok/s from text estimates is noisy (chunk dumps, short windows, CJK heuristic).
  // Match Cherry: only publish rate once the request is closed.
  if (active) {
    return {
      active: true,
      ttftMs,
      streamedTokens,
      tokenSource,
    };
  }

  const MIN_TIMING_MS_FOR_RATE = 50;

  // Gateway-measured TTFT is authoritative for a closed span; the client's first
  // narrative delta is a fallback when the gateway had no timing.
  const gatewayTtftMs =
    typeof span.ttftMs === "number" && Number.isFinite(span.ttftMs) && span.ttftMs >= 0
      ? span.ttftMs
      : undefined;
  const closedTtftMs = gatewayTtftMs ?? ttftMs;
  const generationMs =
    typeof span.generationMs === "number" &&
    Number.isFinite(span.generationMs) &&
    span.generationMs >= MIN_TIMING_MS_FOR_RATE
      ? span.generationMs
      : undefined;
  if (generationMs !== undefined && rateNumerator.tokens > 0) {
    return {
      active: false,
      ttftMs: closedTtftMs,
      rateTps: (rateNumerator.tokens * 1000) / generationMs,
      streamedTokens,
      tokenSource: rateNumerator.tokenSource,
    };
  }

  return {
    active: false,
    ttftMs: closedTtftMs,
    streamedTokens,
    tokenSource,
  };
}

export function formatTokenSpeedSeconds(ms: number): string {
  const seconds = ms / 1000;
  return seconds < 10 ? seconds.toFixed(1) : Math.round(seconds).toString();
}

export function formatTokenSpeedRate(tps: number): string {
  return tps >= 100 ? Math.round(tps).toString() : tps.toFixed(1);
}
