import type { ThreadRunProjectionRequestSpan } from "./thread-run-projection";

export type RequestSpanLedgerUsageSource = "sdk" | "proxy" | "codex" | "pi";

export interface RequestSpanLedgerUsageRow {
  outputTokens: number;
  reasoningTokens?: number;
  providerRequestId?: string;
  requestKey?: string;
  /** Feed logical request id when stored on ledger metadata (multi-invocation turn join). */
  logicalRequestId?: string;
  /** Gateway upstream generation duration for this provider invocation, when known. */
  generationMs?: number;
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

function ledgerRowMatchesRequest(
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
  let generationMs = 0;
  for (const row of rows) {
    if (row.outputTokens > outputTokens) {
      outputTokens = row.outputTokens;
    }
    const reasoning = row.reasoningTokens ?? 0;
    if (reasoning > reasoningTokens) {
      reasoningTokens = reasoning;
    }
    const generation = row.generationMs ?? 0;
    if (generation > generationMs) {
      generationMs = generation;
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
    ...(generationMs > 0 && { generationMs }),
  };
}

/** Cherry-style turn aggregate: sum tokens and generation ms across distinct invocations. */
function aggregateMatchedLedgerRows(rows: readonly RequestSpanLedgerUsageRow[]): {
  outputTokens: number;
  reasoningTokens?: number;
  generationMs?: number;
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
  let generationMs = 0;
  for (const group of groups.values()) {
    const collapsed = collapseInvocationRows(group);
    outputTokens += collapsed.outputTokens;
    reasoningTokens += collapsed.reasoningTokens ?? 0;
    generationMs += collapsed.generationMs ?? 0;
  }

  return {
    outputTokens,
    ...(reasoningTokens > 0 && { reasoningTokens }),
    ...(generationMs > 0 && { generationMs }),
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
      ...(aggregated.generationMs !== undefined &&
        aggregated.generationMs > 0 && { generationMs: aggregated.generationMs }),
    };
  });
}

/** Visible completion tokens for tok/s (excludes provider-reported reasoning). */
export function visibleOutputTokensForRate(span: {
  outputTokens?: number;
  reasoningTokens?: number;
}): number | undefined {
  if (typeof span.outputTokens !== "number" || !Number.isFinite(span.outputTokens) || span.outputTokens <= 0) {
    return undefined;
  }
  const reasoning =
    typeof span.reasoningTokens === "number" && Number.isFinite(span.reasoningTokens) && span.reasoningTokens > 0
      ? Math.floor(span.reasoningTokens)
      : 0;
  return Math.max(0, Math.floor(span.outputTokens) - reasoning);
}

/** Provider completion tokens minus reasoning — includes tool-call JSON when present. */
export function resolveRateNumeratorTokens(input: {
  span: { outputTokens?: number; reasoningTokens?: number };
  estimatedTokens: number;
}): { tokens: number; tokenSource: "usage" | "estimate" } {
  const visibleTokens = visibleOutputTokensForRate(input.span);
  if (visibleTokens === undefined) {
    return {
      tokens: input.estimatedTokens,
      tokenSource: input.estimatedTokens > 0 ? "estimate" : "usage",
    };
  }
  return { tokens: visibleTokens, tokenSource: "usage" };
}
