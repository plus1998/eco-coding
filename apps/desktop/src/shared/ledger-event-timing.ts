import type { ThreadUsageLedgerEventView } from "./ipc";
import type { ThreadRunProjectionRequestSpan } from "./thread-run-projection";
import { ledgerRowMatchesRequest } from "./request-span-usage";

/**
 * Minimum generation window (ms) before publishing a per-row rate.
 * Matches the token-speed badge (`MIN_TIMING_MS_FOR_RATE` in renderer/token-speed.ts).
 */
export const MIN_TIMING_MS_FOR_RATE = 50;

export interface LedgerEventTiming {
  /** Time to first token (ms): gateway-measured value wins, client span is the fallback. */
  ttftMs?: number;
  /** Decode rate in tokens per second over the generation window (first chunk → end). */
  rateTps?: number;
  /** Network RTT estimate (ms): upstream start → first headers. */
  netMs?: number;
  /** Prefill rate (tok/s): input tokens over the headers→first-token window (lower bound). */
  prefillTps?: number;
  /** Strict decode rate (tok/s): output over the window excluding the pre-token wait (matches the badge). */
  decodeTps?: number;
  /** Overall request throughput (tok/s): output over ttft + generation window (new-api comparable). */
  totalTps?: number;
}

/** Rows without any gateway timing are candidates for client span fallback. */
export function isLedgerEventViewSpanTimingCandidate(
  view: Pick<ThreadUsageLedgerEventView, "ttftMs" | "generationMs">,
): boolean {
  return view.ttftMs === undefined && view.generationMs === undefined;
}

interface PeerGatewayTiming {
  ttftMs?: number;
  generationMs?: number;
  firstHeadersMs?: number;
  firstTokenMs?: number;
}

/**
 * Transfer gateway-measured timing onto rows that lack it but share the exact
 * `logicalRequestId` of a row that has it (e.g. PI/SDK rows billed alongside the
 * gateway proxy row for the same invocation).
 *
 * One logical request is one upstream invocation with one gateway measurement,
 * so peers must agree; conflicting peer values fail closed (no transfer).
 */
export function attachPeerGatewayTimingToLedgerEventViews<T extends ThreadUsageLedgerEventView>(
  views: readonly T[],
): T[] {
  const timingByLogicalId = new Map<
    string,
    {
      ttftValues: Set<number>;
      generationValues: Set<number>;
      firstHeadersValues: Set<number>;
      firstTokenValues: Set<number>;
    }
  >();
  for (const view of views) {
    const logicalId = view.logicalRequestId?.trim();
    if (!logicalId) {
      continue;
    }
    const ttftMs = view.ttftMs;
    const generationMs = view.generationMs;
    const firstHeadersMs = view.firstHeadersMs;
    const firstTokenMs = view.firstTokenMs;
    if (
      typeof ttftMs !== "number" &&
      typeof generationMs !== "number" &&
      typeof firstHeadersMs !== "number" &&
      typeof firstTokenMs !== "number"
    ) {
      continue;
    }
    const bucket = timingByLogicalId.get(logicalId) ?? {
      ttftValues: new Set<number>(),
      generationValues: new Set<number>(),
      firstHeadersValues: new Set<number>(),
      firstTokenValues: new Set<number>(),
    };
    if (typeof ttftMs === "number") {
      bucket.ttftValues.add(ttftMs);
    }
    if (typeof generationMs === "number") {
      bucket.generationValues.add(generationMs);
    }
    if (typeof firstHeadersMs === "number") {
      bucket.firstHeadersValues.add(firstHeadersMs);
    }
    if (typeof firstTokenMs === "number") {
      bucket.firstTokenValues.add(firstTokenMs);
    }
    timingByLogicalId.set(logicalId, bucket);
  }
  const agreedByLogicalId = new Map<string, PeerGatewayTiming>();
  for (const [logicalId, bucket] of timingByLogicalId) {
    if (
      bucket.ttftValues.size > 1 ||
      bucket.generationValues.size > 1 ||
      bucket.firstHeadersValues.size > 1 ||
      bucket.firstTokenValues.size > 1
    ) {
      continue; // conflicting measurements — do not guess
    }
    const ttft = bucket.ttftValues.values().next().value;
    const generation = bucket.generationValues.values().next().value;
    const firstHeaders = bucket.firstHeadersValues.values().next().value;
    const firstToken = bucket.firstTokenValues.values().next().value;
    agreedByLogicalId.set(logicalId, {
      ...(typeof ttft === "number" ? { ttftMs: ttft } : {}),
      ...(typeof generation === "number" ? { generationMs: generation } : {}),
      ...(typeof firstHeaders === "number" ? { firstHeadersMs: firstHeaders } : {}),
      ...(typeof firstToken === "number" ? { firstTokenMs: firstToken } : {}),
    });
  }
  if (agreedByLogicalId.size === 0) {
    return [...views];
  }
  return views.map((view) => {
    if (!isLedgerEventViewSpanTimingCandidate(view)) {
      return view;
    }
    const logicalId = view.logicalRequestId?.trim();
    const peer = logicalId ? agreedByLogicalId.get(logicalId) : undefined;
    if (!peer) {
      return view;
    }
    return {
      ...view,
      ...(peer.ttftMs !== undefined ? { ttftMs: peer.ttftMs } : {}),
      ...(peer.generationMs !== undefined ? { generationMs: peer.generationMs } : {}),
      ...(peer.firstHeadersMs !== undefined ? { firstHeadersMs: peer.firstHeadersMs } : {}),
      ...(peer.firstTokenMs !== undefined ? { firstTokenMs: peer.firstTokenMs } : {}),
    };
  });
}

/**
 * Minimum window (ms) between first headers and first token before the
 * prefill-rate estimate is meaningful.
 */
export const MIN_PREFILL_WINDOW_MS = 100;

/**
 * The headers→first-token window is only a valid prefill window when the
 * upstream actually sent its response headers before generation began:
 * - the window must be at least `MIN_PREFILL_WINDOW_MS` — buffering proxies
 *   (frp tunnels, some gateways) hold headers until the first chunk, making
 *   firstHeadersMs ≈ firstTokenMs and collapsing the window to ~ms;
 * - headers must arrive in the first half of the wait
 *   (`firstHeadersMs * 2 <= firstTokenMs`) — rejects late headers that still
 *   land a bit before the token.
 * When unreliable, withhold the prefill estimate instead of showing a bogus
 * number (fail open: no prefill value).
 */
export function resolvePrefillWindowMs(
  firstHeadersMs: number | undefined,
  firstTokenMs: number | undefined,
): number | undefined {
  if (
    typeof firstHeadersMs !== "number" ||
    !Number.isFinite(firstHeadersMs) ||
    typeof firstTokenMs !== "number" ||
    !Number.isFinite(firstTokenMs)
  ) {
    return undefined;
  }
  const windowMs = firstTokenMs - firstHeadersMs;
  if (windowMs < MIN_PREFILL_WINDOW_MS) {
    return undefined;
  }
  if (firstHeadersMs * 2 > firstTokenMs) {
    return undefined;
  }
  return windowMs;
}

/**
 * Attach client-side span timing to rows that lack gateway timing.
 *
 * A span's window is per logical request (turn), so it is only attributed to a row when
 * that row is the sole ledger row matching the span. When a turn aggregates several
 * invocations (or a partial + final pair), the window cannot be pinned to one row and
 * the timing stays empty instead of showing a wrong number.
 */
export function attachSpanTimingToLedgerEventViews<T extends ThreadUsageLedgerEventView>(
  views: readonly T[],
  spans: readonly ThreadRunProjectionRequestSpan[],
): T[] {
  if (views.length === 0 || spans.length === 0) {
    return [...views];
  }
  const candidates = views.filter((view) => isLedgerEventViewSpanTimingCandidate(view));
  if (candidates.length === 0) {
    return [...views];
  }
  const soleMatchByViewId = new Map<string, ThreadRunProjectionRequestSpan>();
  for (const span of spans) {
    if (!span.startedAt) {
      continue;
    }
    const matched = candidates.filter((view) => ledgerRowMatchesRequest(span, view));
    if (matched.length !== 1) {
      continue;
    }
    const [sole] = matched;
    if (!sole) {
      continue;
    }
    // Guard against the same row loosely matching two different spans.
    if (soleMatchByViewId.has(sole.id)) {
      soleMatchByViewId.delete(sole.id);
      continue;
    }
    soleMatchByViewId.set(sole.id, span);
  }
  return views.map((view) => {
    const span = soleMatchByViewId.get(view.id);
    if (!span) {
      return view;
    }
    return {
      ...view,
      spanStartedAt: span.startedAt,
      ...(span.firstTokenAt && { spanFirstTokenAt: span.firstTokenAt }),
      ...(span.endedAt && { spanEndedAt: span.endedAt }),
    };
  });
}

function parseTimeMs(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : undefined;
}

function spanTtftMs(view: { spanStartedAt?: string; spanFirstTokenAt?: string }): number | undefined {
  const startedMs = parseTimeMs(view.spanStartedAt);
  const firstTokenMs = parseTimeMs(view.spanFirstTokenAt);
  if (startedMs === undefined || firstTokenMs === undefined || firstTokenMs < startedMs) {
    return undefined;
  }
  return firstTokenMs - startedMs;
}

function spanGenerationWindowMs(view: { spanFirstTokenAt?: string; spanEndedAt?: string }): number | undefined {
  const firstTokenMs = parseTimeMs(view.spanFirstTokenAt);
  const endedMs = parseTimeMs(view.spanEndedAt);
  if (firstTokenMs === undefined || endedMs === undefined || endedMs < firstTokenMs) {
    return undefined;
  }
  return endedMs - firstTokenMs;
}

/**
 * Resolve the final TTFT / tok/s for one per-billing row.
 *
 * Same basis as the token-speed badge (renderer/token-speed.ts):
 * - TTFT: gateway-measured `ttftMs` wins; otherwise client span `firstTokenAt − startedAt`.
 * - tok/s: provider `outputTokens` over the generation window (first chunk → stream end),
 *   gateway `generationMs` preferred, otherwise span `endedAt − firstTokenAt`.
 *   The rate is withheld for windows shorter than `MIN_TIMING_MS_FOR_RATE` or while the
 *   span is still open — live estimates over partial windows are noisy.
 */
export function resolveLedgerEventTiming(
  view: Pick<
    ThreadUsageLedgerEventView,
    | "outputTokens"
    | "inputTokens"
    | "ttftMs"
    | "generationMs"
    | "firstHeadersMs"
    | "firstTokenMs"
    | "spanStartedAt"
    | "spanFirstTokenAt"
    | "spanEndedAt"
  >,
): LedgerEventTiming {
  let ttftMs: number | undefined;
  if (typeof view.ttftMs === "number" && Number.isFinite(view.ttftMs) && view.ttftMs >= 0) {
    ttftMs = view.ttftMs;
  } else {
    ttftMs = spanTtftMs(view);
  }

  let rateTps: number | undefined;
  let decodeTps: number | undefined;
  let windowMs: number | undefined;
  if (typeof view.generationMs === "number" && Number.isFinite(view.generationMs)) {
    windowMs = view.generationMs;
  } else {
    windowMs = spanGenerationWindowMs(view);
  }
  if (windowMs !== undefined && windowMs >= MIN_TIMING_MS_FOR_RATE && view.outputTokens > 0) {
    rateTps = (view.outputTokens * 1000) / windowMs;
    decodeTps = rateTps;
  }
  // Refine to the strict decode window (exclude the pre-token wait) when gateway
  // timing lets us compute it — same basis as the token-speed badge.
  if (
    decodeTps !== undefined &&
    windowMs !== undefined &&
    ttftMs !== undefined &&
    typeof view.firstTokenMs === "number" &&
    Number.isFinite(view.firstTokenMs)
  ) {
    const strict = windowMs - (view.firstTokenMs - ttftMs);
    if (strict >= MIN_TIMING_MS_FOR_RATE) {
      decodeTps = (view.outputTokens * 1000) / strict;
    }
  }

  // Network RTT estimate (upstream start → first headers).
  const netMs =
    typeof view.firstHeadersMs === "number" && Number.isFinite(view.firstHeadersMs) && view.firstHeadersMs >= 0
      ? view.firstHeadersMs
      : undefined;

  // Prefill rate: input tokens over the headers→first-token window (lower bound).
  const prefillWindowMs = resolvePrefillWindowMs(view.firstHeadersMs, view.firstTokenMs);
  let prefillTps: number | undefined;
  if (
    typeof view.inputTokens === "number" &&
    Number.isFinite(view.inputTokens) &&
    view.inputTokens > 0 &&
    prefillWindowMs !== undefined
  ) {
    prefillTps = (view.inputTokens * 1000) / prefillWindowMs;
  }

  // Overall request throughput (output over ttft + generation window).
  let totalTps: number | undefined;
  if (ttftMs !== undefined && windowMs !== undefined && view.outputTokens > 0) {
    totalTps = (view.outputTokens * 1000) / (ttftMs + windowMs);
  }

  return {
    ...(ttftMs !== undefined && { ttftMs }),
    ...(rateTps !== undefined && { rateTps }),
    ...(netMs !== undefined && { netMs }),
    ...(prefillTps !== undefined && { prefillTps }),
    ...(decodeTps !== undefined && { decodeTps }),
    ...(totalTps !== undefined && { totalTps }),
  };
}
