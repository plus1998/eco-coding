import type { ThreadRunProjectionRequestSpan } from "./thread-run-projection";

export type RequestSpanLedgerUsageSource = "sdk" | "proxy" | "codex" | "pi";

export interface RequestSpanLedgerUsageRow {
  outputTokens: number;
  reasoningTokens?: number;
  providerRequestId?: string;
  requestKey?: string;
  /** Feed logical request id when stored on ledger metadata (multi-invocation turn join). */
  logicalRequestId?: string;
  /** Gateway-measured time to first content token (ms) for this provider invocation, when known. */
  ttftMs?: number;
  /** Gateway-measured first-chunk → stream-end window (ms, new-api generationMs). */
  generationMs?: number;
  /** Gateway-measured network RTT estimate (ms): upstream start → first headers. */
  firstHeadersMs?: number;
  /** Gateway-measured time to first text token delta (ms): upstream start → first content token. */
  firstTokenMs?: number;
  /** Provider input tokens (non-cache) — prefill-rate numerator when paired with timing. */
  inputTokens?: number;
  /** Provider cache-read tokens — used to derive the non-cache input token count. */
  cacheReadTokens?: number;
  /** Ledger billing source — used to dedupe pi vs gateway proxy rows for the same invocation. */
  source?: RequestSpanLedgerUsageSource;
}

function logicalRequestIdMatchesSpan(logicalRequestId: string, spanRequestId: string): boolean {
  const logical = logicalRequestId.trim();
  const requestId = spanRequestId.trim();
  if (!logical || !requestId) {
    return false;
  }
  if (logical === requestId) {
    return true;
  }
  if (logical.endsWith(requestId) || requestId.endsWith(logical)) {
    return true;
  }
  const logicalSuffix = logical.split("-").pop() ?? logical;
  const requestSuffix = requestId.split("-").pop() ?? requestId;
  return logicalSuffix === requestSuffix;
}

export function ledgerRowMatchesRequest(
  span: Pick<ThreadRunProjectionRequestSpan, "requestId" | "providerRequestId">,
  row: RequestSpanLedgerUsageRow,
): boolean {
  const requestId = span.requestId.trim();
  if (!requestId) {
    return false;
  }
  const logicalRequestId = row.logicalRequestId?.trim();
  if (logicalRequestId && logicalRequestIdMatchesSpan(logicalRequestId, requestId)) {
    return true;
  }
  const providerRequestId = row.providerRequestId?.trim();
  if (
    providerRequestId &&
    (providerRequestId === requestId || providerRequestId === span.providerRequestId)
  ) {
    return true;
  }
  const requestKey = row.requestKey?.trim();
  if (!requestKey) {
    return false;
  }
  if (requestKey === requestId) {
    return true;
  }
  // Proxy keys look like `proxy:role:model:requestId:…`.
  return requestKey.split(":").includes(requestId);
}

function invocationGroupKey(row: RequestSpanLedgerUsageRow): string {
  const logicalRequestId = row.logicalRequestId?.trim();
  const providerRequestId = row.providerRequestId?.trim();
  if (logicalRequestId && providerRequestId) {
    return `logical:${logicalRequestId}:provider:${providerRequestId}`;
  }
  if (providerRequestId) {
    return `provider:${providerRequestId}`;
  }
  if (logicalRequestId) {
    return `logical:${logicalRequestId}`;
  }
  const requestKey = row.requestKey?.trim();
  if (requestKey) {
    return `key:${requestKey}`;
  }
  return `row:${row.outputTokens}:${row.reasoningTokens ?? 0}:${row.generationMs ?? 0}`;
}


/** Drop duplicate pi/sdk rows when gateway proxy already billed the same logical request. */
export function dedupeUsageLedgerRowsForSpanJoin(
  rows: readonly RequestSpanLedgerUsageRow[],
): RequestSpanLedgerUsageRow[] {
  if (rows.length <= 1) {
    return [...rows];
  }
  const proxyLogicalIds = new Set<string>();
  for (const row of rows) {
    const source = row.source;
    const logicalRequestId = row.logicalRequestId?.trim();
    if (!logicalRequestId) {
      continue;
    }
    if (source === "proxy" || source === "codex") {
      proxyLogicalIds.add(logicalRequestId);
    }
  }
  if (proxyLogicalIds.size === 0) {
    return [...rows];
  }
  return rows.filter((row) => {
    if (row.source !== "pi" && row.source !== "sdk") {
      return true;
    }
    const logicalRequestId = row.logicalRequestId?.trim();
    return !logicalRequestId || !proxyLogicalIds.has(logicalRequestId);
  });
}

/** Collapse partial+final rows for the same provider invocation — take max per field. */
function collapseInvocationRows(rows: readonly RequestSpanLedgerUsageRow[]): RequestSpanLedgerUsageRow {
  let outputTokens = 0;
  let reasoningTokens = 0;
  let ttftMs = 0;
  let generationMs = 0;
  let firstHeadersMs = 0;
  let firstTokenMs = 0;
  let inputTokens: number | undefined;
  let cacheReadTokens = 0;
  for (const row of rows) {
    if (row.outputTokens > outputTokens) {
      outputTokens = row.outputTokens;
    }
    const reasoning = row.reasoningTokens ?? 0;
    if (reasoning > reasoningTokens) {
      reasoningTokens = reasoning;
    }
    const ttft = row.ttftMs ?? 0;
    if (ttft > ttftMs) {
      ttftMs = ttft;
    }
    const generation = row.generationMs ?? 0;
    if (generation > generationMs) {
      generationMs = generation;
    }
    const firstHeaders = row.firstHeadersMs ?? 0;
    if (firstHeaders > firstHeadersMs) {
      firstHeadersMs = firstHeaders;
    }
    const firstToken = row.firstTokenMs ?? 0;
    if (firstToken > firstTokenMs) {
      firstTokenMs = firstToken;
    }
    if (row.inputTokens !== undefined) {
      const input = row.inputTokens;
      inputTokens = inputTokens === undefined ? input : Math.max(inputTokens, input);
    }
    const cacheRead = row.cacheReadTokens ?? 0;
    if (cacheRead > cacheReadTokens) {
      cacheReadTokens = cacheRead;
    }
  }
  const base = rows[0];
  if (!base) {
    throw new Error("Expected at least one ledger row to collapse.");
  }
  return {
    ...base,
    outputTokens,
    ...(reasoningTokens > 0 && { reasoningTokens: reasoningTokens }),
    ...(ttftMs > 0 && { ttftMs }),
    ...(generationMs > 0 && { generationMs }),
    ...(firstHeadersMs > 0 && { firstHeadersMs }),
    ...(firstTokenMs > 0 && { firstTokenMs }),
    ...(inputTokens !== undefined && { inputTokens }),
    ...(cacheReadTokens > 0 && { cacheReadTokens }),
  };
}

/** Gateway turn aggregate: sum tokens and gateway timing across distinct invocations. */
function aggregateMatchedLedgerRows(rows: readonly RequestSpanLedgerUsageRow[]): {
  outputTokens: number;
  reasoningTokens?: number;
  ttftMs?: number;
  generationMs?: number;
  firstHeadersMs?: number;
  firstTokenMs?: number;
  inputTokens?: number;
  cacheReadTokens?: number;
} | undefined {
  if (rows.length === 0) {
    return undefined;
  }
  const groups = new Map<string, RequestSpanLedgerUsageRow[]>();
  for (const row of rows) {
    if (!(row.outputTokens > 0)) {
      continue;
    }
    const key = invocationGroupKey(row);
    const bucket = groups.get(key) ?? [];
    bucket.push(row);
    groups.set(key, bucket);
  }
  if (groups.size === 0) {
    return undefined;
  }

  let outputTokens = 0;
  let reasoningTokens = 0;
  let ttftMs = 0;
  let generationMs = 0;
  let firstHeadersMs = 0;
  let firstTokenMs = 0;
  let inputTokens = 0;
  let cacheReadTokens = 0;
  for (const group of groups.values()) {
    const collapsed = collapseInvocationRows(group);
    outputTokens += collapsed.outputTokens;
    reasoningTokens += collapsed.reasoningTokens ?? 0;
    ttftMs += collapsed.ttftMs ?? 0;
    generationMs += collapsed.generationMs ?? 0;
    firstHeadersMs += collapsed.firstHeadersMs ?? 0;
    firstTokenMs += collapsed.firstTokenMs ?? 0;
    inputTokens += collapsed.inputTokens ?? 0;
    cacheReadTokens += collapsed.cacheReadTokens ?? 0;
  }

  return {
    outputTokens,
    ...(reasoningTokens > 0 && { reasoningTokens }),
    ...(ttftMs > 0 && { ttftMs }),
    ...(generationMs > 0 && { generationMs }),
    ...(firstHeadersMs > 0 && { firstHeadersMs }),
    ...(firstTokenMs > 0 && { firstTokenMs }),
    ...(inputTokens > 0 && { inputTokens }),
    ...(cacheReadTokens > 0 && { cacheReadTokens }),
  };
}

/**
 * Join ledger completion tokens onto request spans when ids match.
 * Sums across distinct provider invocations in a turn; partial+final rows for
 * the same invocation are collapsed to max before summing.
 */
export function attachOutputTokensToRequestSpans<T extends ThreadRunProjectionRequestSpan>(
  spans: readonly T[],
  ledger: readonly RequestSpanLedgerUsageRow[],
): T[] {
  if (spans.length === 0 || ledger.length === 0) {
    return [...spans];
  }
  const joinedLedger = dedupeUsageLedgerRowsForSpanJoin(ledger);
  return spans.map((span) => {
    const matched = joinedLedger.filter((row) => ledgerRowMatchesRequest(span, row));
    const aggregated = aggregateMatchedLedgerRows(matched);
    if (!aggregated) {
      return span;
    }
    return {
      ...span,
      outputTokens: aggregated.outputTokens,
      ...(aggregated.reasoningTokens !== undefined &&
        aggregated.reasoningTokens > 0 && { reasoningTokens: aggregated.reasoningTokens }),
      ...(aggregated.ttftMs !== undefined && aggregated.ttftMs > 0 && { ttftMs: aggregated.ttftMs }),
      ...(aggregated.generationMs !== undefined &&
        aggregated.generationMs > 0 && { generationMs: aggregated.generationMs }),
      ...(aggregated.firstHeadersMs !== undefined &&
        aggregated.firstHeadersMs > 0 && { firstHeadersMs: aggregated.firstHeadersMs }),
      ...(aggregated.firstTokenMs !== undefined &&
        aggregated.firstTokenMs > 0 && { firstTokenMs: aggregated.firstTokenMs }),
      ...(aggregated.inputTokens !== undefined &&
        aggregated.inputTokens >= 0 &&
        { inputTokens: aggregated.inputTokens }),
      ...(aggregated.cacheReadTokens !== undefined &&
        aggregated.cacheReadTokens > 0 && { cacheReadTokens: aggregated.cacheReadTokens }),
    };
  });
}

/**
 * Rate numerator, new-api style: full provider completion tokens (includes
 * thinking + tool-call tokens) over the first-chunk → stream-end window;
 * falls back to a local text estimate when the provider reported no usage.
 */
export function resolveRateNumeratorTokens(input: {
  span: { outputTokens?: number };
  estimatedTokens: number;
}): { tokens: number; tokenSource: "usage" | "estimate" } {
  const totalOutput =
    typeof input.span.outputTokens === "number" &&
    Number.isFinite(input.span.outputTokens) &&
    input.span.outputTokens > 0
      ? Math.floor(input.span.outputTokens)
      : undefined;
  if (totalOutput !== undefined) {
    return { tokens: totalOutput, tokenSource: "usage" };
  }
  return {
    tokens: input.estimatedTokens,
    tokenSource: input.estimatedTokens > 0 ? "estimate" : "usage",
  };
}
