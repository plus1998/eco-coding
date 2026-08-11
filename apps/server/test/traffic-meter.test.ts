import { expect, test } from "bun:test";
import {
  jsonByteLength,
  TrafficMeter,
  TRAFFIC_BUCKET_MS,
  utf8ByteLength,
} from "../src/metrics/traffic-meter";

test("utf8ByteLength counts UTF-8 bytes", () => {
  expect(utf8ByteLength("abc")).toBe(3);
  expect(utf8ByteLength("你")).toBe(3);
  expect(utf8ByteLength(new Uint8Array([1, 2, 3, 4]))).toBe(4);
  expect(jsonByteLength({ a: 1 })).toBe(utf8ByteLength(JSON.stringify({ a: 1 })));
});

test("records http and dimensions with snapshot totals", () => {
  const meter = new TrafficMeter({ instanceId: "srv_test", now: () => 1_000_000 });
  meter.recordHttp({
    route: "GET /v1/presence",
    status: 200,
    bytesIn: 0,
    bytesOut: 120,
  });
  meter.recordHttp({
    route: "POST /v1/auth/login",
    status: 200,
    bytesIn: 40,
    bytesOut: 200,
  });

  const snap = meter.snapshot();
  expect(snap.instanceId).toBe("srv_test");
  expect(snap.totals).toMatchObject({
    requests: 2,
    bytesIn: 40,
    bytesOut: 320,
  });
  expect(snap.httpByRoute).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ key: "GET /v1/presence", count: 1, bytesOut: 120 }),
      expect.objectContaining({ key: "POST /v1/auth/login", count: 1, bytesIn: 40 }),
    ]),
  );
  expect(snap.windows["60s"].requests).toBe(2);
  expect(snap.windows["60s"].bytesOut).toBe(320);
});

test("records ws frames, rpc methods, invoke channels, and event fanout", () => {
  const meter = new TrafficMeter({ instanceId: "srv_test" });
  meter.recordWsFrame({ direction: "in", deviceKind: "mobile", method: "eco.invoke", bytes: 500 });
  meter.recordRpc({ method: "eco.invoke", direction: "in", bytes: 500 });
  meter.recordInvoke({ channel: "thread:activity-list", direction: "in", bytes: 500 });

  meter.recordWsFrame({ direction: "out", deviceKind: "desktop", method: "eco.invoke", bytes: 800 });
  meter.recordInvoke({ channel: "thread:activity-list", direction: "out", bytes: 800 });

  meter.recordEventFanout({ kind: "thread.projection", frameBytes: 1000, fanoutCount: 2 });

  const snap = meter.snapshot();
  expect(snap.totals.wsMessagesIn).toBe(1);
  expect(snap.totals.wsMessagesOut).toBe(1);
  expect(snap.totals.bytesIn).toBe(500);
  // ws out 800 + event attribution is NOT double-counted into totals (event is diagnostic only)
  expect(snap.totals.bytesOut).toBe(800);
  expect(snap.invokeByChannel[0]).toMatchObject({
    key: "thread:activity-list",
    count: 2,
    bytesIn: 500,
    bytesOut: 800,
  });
  expect(snap.eventByKind[0]).toMatchObject({
    key: "thread.projection",
    count: 2,
    bytesOut: 2000,
  });
  expect(snap.byDeviceKind).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ key: "mobile", bytesIn: 500 }),
      expect.objectContaining({ key: "desktop", bytesOut: 800 }),
    ]),
  );
});

test("reset clears totals and windows", () => {
  const meter = new TrafficMeter({ instanceId: "srv_test" });
  meter.recordHttp({ route: "GET /health", status: 200, bytesIn: 0, bytesOut: 12 });
  meter.reset();
  const snap = meter.snapshot();
  expect(snap.totals.requests).toBe(0);
  expect(snap.httpByRoute).toEqual([]);
  expect(snap.windows["60s"].requests).toBe(0);
});

test("sliding window only includes recent buckets", () => {
  let now = 0;
  const meter = new TrafficMeter({
    instanceId: "srv_window",
    now: () => now,
  });

  now = TRAFFIC_BUCKET_MS * 0 + 100;
  meter.recordHttp({ route: "GET /old", status: 200, bytesIn: 0, bytesOut: 1000 });

  now = TRAFFIC_BUCKET_MS * 10 + 100; // 100s later
  meter.recordHttp({ route: "GET /new", status: 200, bytesIn: 0, bytesOut: 50 });

  const window60 = meter.snapshot().windows["60s"];
  expect(window60.bytesOut).toBe(50);
  expect(window60.httpByRoute.map((row) => row.key)).toEqual(["GET /new"]);

  const window15m = meter.snapshot().windows["15m"];
  expect(window15m.bytesOut).toBe(1050);
});
