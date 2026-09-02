import { expect, test } from "bun:test";

import {
  auditTokenSpeedRequestSpan,
  clearTokenSpeedAuditStateForTests,
  lookupGatewayGenerationMs,
  recordGatewayRequestLifecycleTiming,
} from "../src/main/token-speed-audit";

test("lookupGatewayGenerationMs resolves by logical and provider request id", () => {
  clearTokenSpeedAuditStateForTests();
  const threadId = "thr_lookup_gen";
  const logicalId = "req_logical";
  const providerId = "req_provider";

  recordGatewayRequestLifecycleTiming(threadId, {
    type: "upstream.started",
    source: "messages",
    providerId: "p",
    requestedModel: "m",
    upstreamModelId: "m",
    logicalRequestId: logicalId,
    attemptIndex: 0,
    observedAt: "2026-01-01T00:00:01.000Z",
  });
  recordGatewayRequestLifecycleTiming(threadId, {
    type: "logical.completed",
    source: "messages",
    providerId: "p",
    requestedModel: "m",
    upstreamModelId: "m",
    logicalRequestId: logicalId,
    attemptIndex: 0,
    providerRequestId: providerId,
    observedAt: "2026-01-01T00:00:04.000Z",
  });

  expect(lookupGatewayGenerationMs(threadId, { logicalRequestId: logicalId })).toBe(3_000);
  expect(lookupGatewayGenerationMs(threadId, { providerRequestId: providerId })).toBe(3_000);
});

test("lookupGatewayGenerationMs falls back to usage observedAt when logical.completed is missing", () => {
  clearTokenSpeedAuditStateForTests();
  const threadId = "thr_usage_observed";
  const turnId = "01a06175-ec1d-70b0-87bb-0740dd1abfcc";

  recordGatewayRequestLifecycleTiming(threadId, {
    type: "upstream.started",
    source: "responses",
    providerId: "longcat",
    requestedModel: "LongCat-2.0",
    upstreamModelId: "LongCat-2.0",
    logicalRequestId: turnId,
    attemptIndex: 0,
    threadId,
    observedAt: "2026-01-01T00:00:01.000Z",
  });

  expect(
    lookupGatewayGenerationMs(
      threadId,
      { logicalRequestId: turnId },
      "2026-01-01T00:00:06.500Z",
    ),
  ).toBe(5_500);
  expect(lookupGatewayGenerationMs(threadId, { logicalRequestId: turnId })).toBeUndefined();
});

test("token speed audit logs skew when gateway completes after feed stream finalize", () => {
  clearTokenSpeedAuditStateForTests();
  const prevDiag = process.env.ECO_DIAG_LOG;
  process.env.ECO_DIAG_LOG = "1";
  const threadId = "thr_audit_skew";
  const logicalId = "req_logical_skew";

  recordGatewayRequestLifecycleTiming(threadId, {
    type: "upstream.started",
    source: "messages",
    providerId: "p",
    requestedModel: "m",
    upstreamModelId: "m",
    logicalRequestId: logicalId,
    attemptIndex: 0,
    observedAt: "2026-01-01T00:00:01.000Z",
  });
  recordGatewayRequestLifecycleTiming(threadId, {
    type: "upstream.headers",
    source: "messages",
    providerId: "p",
    requestedModel: "m",
    upstreamModelId: "m",
    logicalRequestId: logicalId,
    attemptIndex: 0,
    statusCode: 200,
    observedAt: "2026-01-01T00:00:02.000Z",
  });
  recordGatewayRequestLifecycleTiming(threadId, {
    type: "logical.completed",
    source: "messages",
    providerId: "p",
    requestedModel: "m",
    upstreamModelId: "m",
    logicalRequestId: logicalId,
    attemptIndex: 0,
    observedAt: "2026-01-01T00:00:04.600Z",
  });

  const stderrLines: string[] = [];
  const originalWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((chunk: string | Uint8Array) => {
    stderrLines.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
    return true;
  }) as typeof process.stderr.write;

  try {
    auditTokenSpeedRequestSpan(threadId, {
      requestId: logicalId,
      status: "completed",
      role: "planner",
      startedAt: "2026-01-01T00:00:01.000Z",
      firstTokenAt: "2026-01-01T00:00:02.000Z",
      streamingEndedAt: "2026-01-01T00:00:04.000Z",
      endedAt: "2026-01-01T00:00:04.000Z",
      outputTokens: 120,
    });
  } finally {
    process.stderr.write = originalWrite;
    if (prevDiag === undefined) {
      delete process.env.ECO_DIAG_LOG;
    } else {
      process.env.ECO_DIAG_LOG = prevDiag;
    }
  }

  const payload = stderrLines
    .join("")
    .split("\n")
    .find((line) => line.includes('"topic":"token_speed.audit"'));
  expect(payload).toBeDefined();
  const parsed = JSON.parse(payload!.replace(/^\[eco-diag\] /, "")) as {
    topic: string;
    suspicious: boolean;
    completedSkewMs?: number;
    gatewayUpstreamMs?: number;
    feedDecodeMs?: number;
  };
  expect(parsed.topic).toBe("token_speed.audit");
  expect(parsed.suspicious).toBe(true);
  expect(parsed.gatewayVsStreamSkewMs).toBe(600);
  expect(parsed.gatewayUpstreamMs).toBe(3600);
  expect(parsed.feedDecodeMs).toBe(2000);
});
