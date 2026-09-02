import { expect, test } from "bun:test";
import { PROXY_PENDING_ATTRIBUTION_REASON } from "../src/main/proxy-usage-pending-settlement";
import { buildSingleUsageLedgerEvent } from "../src/main/usage-ledger-adapters";
import { buildThreadUsageLedgerEventView } from "../src/main/usage-ledger-view";

test("buildThreadUsageLedgerEventView exposes routeRole billingRole and attribution", () => {
  const event = buildSingleUsageLedgerEvent({
    threadId: "thr_view",
    role: "coder",
    source: "proxy",
    sourceEventId: "proxy:coder:req_1",
    usage: { inputTokens: 1000, outputTokens: 100, cacheReadTokens: 0, cacheCreationTokens: 0 },
    attribution: { status: "pending", reason: PROXY_PENDING_ATTRIBUTION_REASON },
    modelId: "haiku",
    requestKey: "proxy:coder:req_1",
    computedBilling: {
      ecoCostUsd: 0.012,
      plannerTokenCostUsd: 0.033,
      pricingResolved: true,
      ecoBreakdown: null,
      plannerBreakdown: null,
    },
    reportedCostUsd: 0.014,
    metadata: {
      routeRole: "coder",
      billingRole: "coder",
      aliasModelId: "eco-coder-abc",
      providerId: "provider_test",
    },
  });

  expect(buildThreadUsageLedgerEventView(event)).toEqual({
    id: event.id,
    source: "proxy",
    role: "coder",
    routeRole: "coder",
    billingRole: "coder",
    modelId: "haiku",
    aliasModelId: "eco-coder-abc",
    providerId: "provider_test",
    requestKey: "proxy:coder:req_1",
    attributionStatus: "pending",
    attributionReason: PROXY_PENDING_ATTRIBUTION_REASON,
    inputTokens: 1000,
    outputTokens: 100,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    ecoCostUsd: 0.012,
    reportedCostUsd: 0.014,
    pricingResolved: true,
    observedAt: event.observedAt,
  });
});
