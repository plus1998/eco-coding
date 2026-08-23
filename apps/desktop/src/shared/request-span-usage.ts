import type { ThreadRunProjectionRequestSpan } from "./thread-run-projection";

export interface RequestSpanLedgerUsageRow {
  outputTokens: number;
  providerRequestId?: string;
  requestKey?: string;
}

function ledgerRowMatchesRequest(
  span: Pick<ThreadRunProjectionRequestSpan, "requestId" | "providerRequestId">,
  row: RequestSpanLedgerUsageRow,
): boolean {
  const requestId = span.requestId.trim();
  if (!requestId) {
    return false;
  }
  const providerRequestId = row.providerRequestId?.trim();
  if (providerRequestId && (providerRequestId === requestId || providerRequestId === span.providerRequestId)) {
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

/**
 * Join ledger completion tokens onto request spans when ids match.
 * Takes the max matched `outputTokens` per span so partial+final rows do not sum.
 */
export function attachOutputTokensToRequestSpans<T extends ThreadRunProjectionRequestSpan>(
  spans: readonly T[],
  ledger: readonly RequestSpanLedgerUsageRow[],
): T[] {
  if (spans.length === 0 || ledger.length === 0) {
    return [...spans];
  }
  return spans.map((span) => {
    let best: number | undefined;
    for (const row of ledger) {
      if (!(row.outputTokens > 0) || !ledgerRowMatchesRequest(span, row)) {
        continue;
      }
      best = best === undefined ? row.outputTokens : Math.max(best, row.outputTokens);
    }
    if (best === undefined) {
      return span;
    }
    return { ...span, outputTokens: best };
  });
}
