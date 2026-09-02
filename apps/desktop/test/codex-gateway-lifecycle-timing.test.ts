import { expect, test } from "bun:test";
import {
  GATEWAY_LOGICAL_REQUEST_ID_HEADER,
  GATEWAY_THREAD_ID_HEADER,
  CODEX_TURN_METADATA_HEADER,
} from "@eco/gateway";

import {
  clearTokenSpeedAuditStateForTests,
  lookupGatewayGenerationMs,
  recordGatewayRequestLifecycleTiming,
} from "../src/main/token-speed-audit";

test("lookupGatewayGenerationMs joins Codex turnId logical id with Eco threadId", () => {
  clearTokenSpeedAuditStateForTests();
  const ecoThreadId = "thr_eco_codex_timing";
  const turnId = "01a06156-ac0e-7241-bd1b-3e00e85a7b54";
  const providerRequestId = "resp_codex_timing_1";

  recordGatewayRequestLifecycleTiming(ecoThreadId, {
    type: "upstream.started",
    source: "responses",
    providerId: "longcat",
    requestedModel: "LongCat-2.0",
    upstreamModelId: "LongCat-2.0",
    logicalRequestId: turnId,
    attemptIndex: 0,
    threadId: ecoThreadId,
    observedAt: "2026-01-01T00:00:01.000Z",
  });
  recordGatewayRequestLifecycleTiming(ecoThreadId, {
    type: "logical.completed",
    source: "responses",
    providerId: "longcat",
    requestedModel: "LongCat-2.0",
    upstreamModelId: "LongCat-2.0",
    logicalRequestId: turnId,
    attemptIndex: 0,
    threadId: ecoThreadId,
    providerRequestId,
    observedAt: "2026-01-01T00:00:12.500Z",
  });

  expect(
    lookupGatewayGenerationMs(ecoThreadId, {
      logicalRequestId: turnId,
      providerRequestId,
    }),
  ).toBe(11_500);
});

test("codex turn metadata header names used by bridge identity stamp", () => {
  expect(GATEWAY_THREAD_ID_HEADER).toBe("x-gateway-thread-id");
  expect(GATEWAY_LOGICAL_REQUEST_ID_HEADER).toBe("x-eco-logical-request-id");
  expect(CODEX_TURN_METADATA_HEADER).toBe("x-codex-turn-metadata");
});
