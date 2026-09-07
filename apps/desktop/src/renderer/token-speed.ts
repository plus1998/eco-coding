import type { ThreadRunProjectionRequestSpan } from "../shared/thread-run-projection";
import { estimateTextTokens } from "../shared/token-estimate";
import { resolvePrefillWindowMs } from "../shared/ledger-event-timing";
import { resolveRateNumeratorTokens } from "../shared/request-span-usage";
import type { TokenSpeedDisplayMode } from "./token-speed-preferences";

export type TokenSpeedTokenSource = "usage" | "estimate";

export interface TokenSpeedStats {
  /** True while the request span is still open (waiting or streaming). */
  active: boolean;
  /** Elapsed ms while waiting for the first token (live). */
  waitingMs?: number;
  /** Time to first token in ms; undefined until the first token arrives. */
  ttftMs?: number;
  /**
   * Decode rate in tokens per second over the strict decode window (excludes prefill/queue).
   * Only set after the request span closes — live estimates over partial windows are withheld.
   */
  decodeTps?: number;
  /** Network RTT estimate in ms (upstream start → first headers). */
  netMs?: number;
  /** Prefill rate in tok/s (input tokens over headers→first-token window; lower bound). */
  prefillTps?: number;
  /**
   * Overall request throughput in tok/s (output tokens over ttft + generation).
   * For active spans this is a live estimate over elapsed wall time since the
   * request started (published only once at least 1s has elapsed).
   */
  totalTps?: number;
  /** Tokens used for the rate numerator. */
  streamedTokens: number;
  /** Whether `streamedTokens` / `decodeTps` came from provider usage or a local heuristic. */
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
    | "firstHeadersMs"
    | "firstTokenMs"
    | "inputTokens"
    | "cacheReadTokens"
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
  // Match Cherry: only publish the strict decode/prefill rates once the request
  // is closed. The live throughput (tokens over wall time since start) is stable
  // enough to show while streaming.
  if (active) {
    const elapsedMs = Math.max(0, nowMs - startedMs);
    const liveTotalTps =
      rateNumerator.tokens > 0 && elapsedMs >= 1000
        ? (rateNumerator.tokens * 1000) / elapsedMs
        : undefined;
    return {
      active: true,
      ttftMs,
      ...(liveTotalTps !== undefined && { totalTps: liveTotalTps }),
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

  // Network RTT estimate (upstream start → first headers).
  const netMs =
    typeof span.firstHeadersMs === "number" && Number.isFinite(span.firstHeadersMs) && span.firstHeadersMs >= 0
      ? span.firstHeadersMs
      : undefined;

  // Prefill rate: input tokens over the headers→first-token window (lower bound;
  // includes queueing + cached-KV read). Withheld when the window is unreliable
  // (buffering proxies send headers together with the first chunk).
  const prefillWindowMs = resolvePrefillWindowMs(span.firstHeadersMs, span.firstTokenMs);
  let prefillTps: number | undefined;
  if (
    typeof span.inputTokens === "number" &&
    Number.isFinite(span.inputTokens) &&
    span.inputTokens > 0 &&
    prefillWindowMs !== undefined
  ) {
    prefillTps = (span.inputTokens * 1000) / prefillWindowMs;
  }

  // Strict decode window: generationMs minus the prefill portion (firstTokenMs − ttftMs).
  // This excludes queueing/cached-KV time so the decode rate reflects actual token generation.
  let decodeWindowMs = generationMs;
  if (generationMs !== undefined && typeof span.firstTokenMs === "number" && Number.isFinite(span.firstTokenMs)) {
    const ttftOffset =
      typeof gatewayTtftMs === "number" && Number.isFinite(gatewayTtftMs) ? gatewayTtftMs : ttftMs;
    if (typeof ttftOffset === "number" && Number.isFinite(ttftOffset)) {
      const strict = generationMs - (span.firstTokenMs - ttftOffset);
      if (strict >= MIN_TIMING_MS_FOR_RATE) {
        decodeWindowMs = strict;
      }
    }
  }

  let decodeTps: number | undefined;
  if (decodeWindowMs !== undefined && decodeWindowMs >= MIN_TIMING_MS_FOR_RATE && rateNumerator.tokens > 0) {
    decodeTps = (rateNumerator.tokens * 1000) / decodeWindowMs;
  }

  // Overall request throughput (output tokens over full request latency).
  let totalTps: number | undefined;
  if (closedTtftMs !== undefined && generationMs !== undefined && rateNumerator.tokens > 0) {
    totalTps = (rateNumerator.tokens * 1000) / (closedTtftMs + generationMs);
  }

  return {
    active: false,
    ttftMs: closedTtftMs,
    ...(decodeTps !== undefined && { decodeTps }),
    ...(netMs !== undefined && { netMs }),
    ...(prefillTps !== undefined && { prefillTps }),
    ...(totalTps !== undefined && { totalTps }),
    streamedTokens,
    tokenSource: rateNumerator.tokenSource,
  };
}

export function formatTokenSpeedSeconds(ms: number): string {
  const seconds = ms / 1000;
  return seconds < 10 ? seconds.toFixed(1) : Math.round(seconds).toString();
}

/** One displayable segment of the token-speed label, keyed for i18n. */
export type TokenSpeedSegment =
  | { key: "waiting"; seconds: string }
  | { key: "ttft"; seconds: string }
  | { key: "total"; rate: string }
  | { key: "prefill"; rate: string }
  | { key: "decode"; rate: string; estimated: boolean };

/**
 * Build the ordered label segments for a display mode.
 * - `hidden` → no segments.
 * - `throughput` → waiting?, first-token, total throughput.
 * - `detailed` → the above plus prefill and strict decode when available;
 *   unavailable segments are simply withheld (graceful degradation).
 */
export function resolveTokenSpeedSegments(
  stats: Pick<
    TokenSpeedStats,
    "waitingMs" | "ttftMs" | "totalTps" | "prefillTps" | "decodeTps" | "tokenSource"
  >,
  mode: TokenSpeedDisplayMode,
): TokenSpeedSegment[] {
  if (mode === "hidden") {
    return [];
  }
  const segments: TokenSpeedSegment[] = [];
  if (stats.waitingMs !== undefined) {
    segments.push({ key: "waiting", seconds: formatTokenSpeedSeconds(stats.waitingMs) });
  }
  if (stats.ttftMs !== undefined) {
    segments.push({ key: "ttft", seconds: formatTokenSpeedSeconds(stats.ttftMs) });
  }
  if (stats.totalTps !== undefined) {
    segments.push({ key: "total", rate: formatTokenSpeedRate(stats.totalTps) });
  }
  if (mode === "detailed") {
    if (stats.prefillTps !== undefined) {
      segments.push({ key: "prefill", rate: formatTokenSpeedPrefill(stats.prefillTps) });
    }
    if (stats.decodeTps !== undefined) {
      segments.push({
        key: "decode",
        rate: formatTokenSpeedRate(stats.decodeTps),
        estimated: stats.tokenSource === "estimate",
      });
    }
  }
  return segments;
}

export function formatTokenSpeedRate(tps: number): string {
  return tps >= 100 ? Math.round(tps).toString() : tps.toFixed(1);
}

/** Prefill values can be large (fast KV reads) — use a K-suffix above 1000. */
export function formatTokenSpeedPrefill(tps: number): string {
  if (tps >= 1000) {
    return `${(tps / 1000).toFixed(1)}K`;
  }
  return formatTokenSpeedRate(tps);
}
