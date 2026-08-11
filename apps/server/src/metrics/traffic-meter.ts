/** In-process traffic counters for Center Server diagnostics (no Mongo). */

const utf8Encoder = new TextEncoder();

export const TRAFFIC_BUCKET_MS = 10_000;
export const TRAFFIC_MAX_BUCKETS = 90; // 15 minutes of 10s buckets

export type DimStats = {
  count: number;
  bytesIn: number;
  bytesOut: number;
};

export type TrafficWindowId = "60s" | "5m" | "15m";

export type TrafficWindowSnapshot = {
  durationMs: number;
  requests: number;
  bytesIn: number;
  bytesOut: number;
  wsMessagesIn: number;
  wsMessagesOut: number;
  busMessagesIn: number;
  busMessagesOut: number;
  bytesInPerSec: number;
  bytesOutPerSec: number;
  requestsPerSec: number;
  httpByRoute: Array<{ key: string } & DimStats>;
  rpcByMethod: Array<{ key: string } & DimStats>;
  invokeByChannel: Array<{ key: string } & DimStats>;
  eventByKind: Array<{ key: string } & DimStats>;
  byDeviceKind: Array<{ key: string } & DimStats>;
};

export type TrafficSnapshot = {
  instanceId: string;
  startedAt: string;
  uptimeMs: number;
  totals: {
    requests: number;
    bytesIn: number;
    bytesOut: number;
    wsMessagesIn: number;
    wsMessagesOut: number;
    busMessagesIn: number;
    busMessagesOut: number;
  };
  httpByRoute: Array<{ key: string } & DimStats>;
  rpcByMethod: Array<{ key: string } & DimStats>;
  invokeByChannel: Array<{ key: string } & DimStats>;
  eventByKind: Array<{ key: string } & DimStats>;
  byDeviceKind: Array<{ key: string } & DimStats>;
  windows: Record<TrafficWindowId, TrafficWindowSnapshot>;
};

type Bucket = {
  /** Bucket start floor (epoch ms aligned to TRAFFIC_BUCKET_MS). */
  t: number;
  requests: number;
  bytesIn: number;
  bytesOut: number;
  wsMessagesIn: number;
  wsMessagesOut: number;
  busMessagesIn: number;
  busMessagesOut: number;
  http: Map<string, DimStats>;
  rpc: Map<string, DimStats>;
  invoke: Map<string, DimStats>;
  event: Map<string, DimStats>;
  byDeviceKind: Map<string, DimStats>;
};

const WINDOW_SPECS: Array<{ id: TrafficWindowId; durationMs: number }> = [
  { id: "60s", durationMs: 60_000 },
  { id: "5m", durationMs: 5 * 60_000 },
  { id: "15m", durationMs: 15 * 60_000 },
];

const TOP_N = 32;

export function utf8ByteLength(value: string | Uint8Array): number {
  if (typeof value === "string") {
    return utf8Encoder.encode(value).byteLength;
  }
  return value.byteLength;
}

export function jsonByteLength(value: unknown): number {
  return utf8ByteLength(JSON.stringify(value));
}

function emptyDim(): DimStats {
  return { count: 0, bytesIn: 0, bytesOut: 0 };
}

function addDim(target: DimStats, delta: Partial<DimStats>): void {
  target.count += delta.count ?? 0;
  target.bytesIn += delta.bytesIn ?? 0;
  target.bytesOut += delta.bytesOut ?? 0;
}

function bumpMap(map: Map<string, DimStats>, key: string, delta: Partial<DimStats>): void {
  const current = map.get(key) ?? emptyDim();
  addDim(current, delta);
  map.set(key, current);
}

function mergeDimMaps(into: Map<string, DimStats>, from: Map<string, DimStats>): void {
  for (const [key, stats] of from) {
    bumpMap(into, key, stats);
  }
}

function rankDims(map: Map<string, DimStats>, limit = TOP_N): Array<{ key: string } & DimStats> {
  return [...map.entries()]
    .map(([key, stats]) => ({ key, ...stats }))
    .sort((a, b) => {
      const aBytes = a.bytesIn + a.bytesOut;
      const bBytes = b.bytesIn + b.bytesOut;
      if (bBytes !== aBytes) return bBytes - aBytes;
      return b.count - a.count;
    })
    .slice(0, limit);
}

function emptyBucket(t: number): Bucket {
  return {
    t,
    requests: 0,
    bytesIn: 0,
    bytesOut: 0,
    wsMessagesIn: 0,
    wsMessagesOut: 0,
    busMessagesIn: 0,
    busMessagesOut: 0,
    http: new Map(),
    rpc: new Map(),
    invoke: new Map(),
    event: new Map(),
    byDeviceKind: new Map(),
  };
}

export class TrafficMeter {
  private _instanceId: string;
  private readonly clock: () => number;
  private startedAtMs: number;
  private totals = {
    requests: 0,
    bytesIn: 0,
    bytesOut: 0,
    wsMessagesIn: 0,
    wsMessagesOut: 0,
    busMessagesIn: 0,
    busMessagesOut: 0,
  };
  private http = new Map<string, DimStats>();
  private rpc = new Map<string, DimStats>();
  private invoke = new Map<string, DimStats>();
  private event = new Map<string, DimStats>();
  private byDeviceKind = new Map<string, DimStats>();
  private buckets: Bucket[] = [];

  constructor(options: { instanceId?: string; now?: () => number } = {}) {
    this._instanceId = options.instanceId ?? "unknown";
    this.clock = options.now ?? Date.now;
    this.startedAtMs = this.clock();
  }

  get instanceId(): string {
    return this._instanceId;
  }

  configure(options: { instanceId: string }): void {
    this._instanceId = options.instanceId;
  }

  reset(): void {
    this.startedAtMs = this.clock();
    this.totals = {
      requests: 0,
      bytesIn: 0,
      bytesOut: 0,
      wsMessagesIn: 0,
      wsMessagesOut: 0,
      busMessagesIn: 0,
      busMessagesOut: 0,
    };
    this.http = new Map();
    this.rpc = new Map();
    this.invoke = new Map();
    this.event = new Map();
    this.byDeviceKind = new Map();
    this.buckets = [];
  }

  recordHttp(input: {
    route: string;
    status: number;
    bytesIn: number;
    bytesOut: number;
  }): void {
    const bytesIn = Math.max(0, input.bytesIn);
    const bytesOut = Math.max(0, input.bytesOut);
    this.totals.requests += 1;
    this.totals.bytesIn += bytesIn;
    this.totals.bytesOut += bytesOut;
    bumpMap(this.http, input.route, { count: 1, bytesIn, bytesOut });

    const bucket = this.currentBucket();
    bucket.requests += 1;
    bucket.bytesIn += bytesIn;
    bucket.bytesOut += bytesOut;
    bumpMap(bucket.http, input.route, { count: 1, bytesIn, bytesOut });
  }

  recordWsFrame(input: {
    direction: "in" | "out";
    deviceKind?: string;
    method?: string;
    bytes: number;
  }): void {
    const bytes = Math.max(0, input.bytes);
    const bucket = this.currentBucket();
    if (input.direction === "in") {
      this.totals.wsMessagesIn += 1;
      this.totals.bytesIn += bytes;
      bucket.wsMessagesIn += 1;
      bucket.bytesIn += bytes;
    } else {
      this.totals.wsMessagesOut += 1;
      this.totals.bytesOut += bytes;
      bucket.wsMessagesOut += 1;
      bucket.bytesOut += bytes;
    }
    if (input.deviceKind) {
      const delta =
        input.direction === "in"
          ? { count: 1, bytesIn: bytes, bytesOut: 0 }
          : { count: 1, bytesIn: 0, bytesOut: bytes };
      bumpMap(this.byDeviceKind, input.deviceKind, delta);
      bumpMap(bucket.byDeviceKind, input.deviceKind, delta);
    }
  }

  recordRpc(input: {
    method: string;
    direction: "in" | "out";
    bytes: number;
  }): void {
    const bytes = Math.max(0, input.bytes);
    const delta =
      input.direction === "in"
        ? { count: 1, bytesIn: bytes, bytesOut: 0 }
        : { count: 1, bytesIn: 0, bytesOut: bytes };
    bumpMap(this.rpc, input.method, delta);
    bumpMap(this.currentBucket().rpc, input.method, delta);
  }

  recordInvoke(input: {
    channel: string;
    direction: "in" | "out";
    bytes: number;
  }): void {
    const bytes = Math.max(0, input.bytes);
    const delta =
      input.direction === "in"
        ? { count: 1, bytesIn: bytes, bytesOut: 0 }
        : { count: 1, bytesIn: 0, bytesOut: bytes };
    bumpMap(this.invoke, input.channel, delta);
    bumpMap(this.currentBucket().invoke, input.channel, delta);
  }

  /**
   * Event publish fanout: network copy volume is `frameBytes * fanoutCount`.
   * count increments by fanoutCount (delivered copies).
   */
  recordEventFanout(input: { kind: string; frameBytes: number; fanoutCount: number }): void {
    const fanoutCount = Math.max(0, input.fanoutCount);
    const frameBytes = Math.max(0, input.frameBytes);
    const bytesOut = frameBytes * fanoutCount;
    const delta = { count: fanoutCount, bytesIn: 0, bytesOut };
    bumpMap(this.event, input.kind || "unknown", delta);
    bumpMap(this.currentBucket().event, input.kind || "unknown", delta);
  }

  /**
   * Cross-instance Redis bus frames. Counted separately from client wire totals
   * so multi-hop copies do not inflate mobile-facing traffic.
   */
  recordBus(input: { direction: "in" | "out"; bytes: number; type?: string }): void {
    const bytes = Math.max(0, input.bytes);
    const bucket = this.currentBucket();
    if (input.direction === "in") {
      this.totals.busMessagesIn += 1;
      bucket.busMessagesIn += 1;
    } else {
      this.totals.busMessagesOut += 1;
      bucket.busMessagesOut += 1;
    }
    const key = input.type ? `bus.${input.type}` : "bus";
    const delta =
      input.direction === "in"
        ? { count: 1, bytesIn: bytes, bytesOut: 0 }
        : { count: 1, bytesIn: 0, bytesOut: bytes };
    bumpMap(this.rpc, key, delta);
    bumpMap(bucket.rpc, key, delta);
  }

  snapshot(): TrafficSnapshot {
    const now = this.clock();
    this.pruneBuckets(now);
    return {
      instanceId: this.instanceId,
      startedAt: new Date(this.startedAtMs).toISOString(),
      uptimeMs: Math.max(0, now - this.startedAtMs),
      totals: { ...this.totals },
      httpByRoute: rankDims(this.http),
      rpcByMethod: rankDims(this.rpc),
      invokeByChannel: rankDims(this.invoke),
      eventByKind: rankDims(this.event),
      byDeviceKind: rankDims(this.byDeviceKind),
      windows: {
        "60s": this.windowSnapshot("60s", now),
        "5m": this.windowSnapshot("5m", now),
        "15m": this.windowSnapshot("15m", now),
      },
    };
  }

  private windowSnapshot(id: TrafficWindowId, now: number): TrafficWindowSnapshot {
    const durationMs = WINDOW_SPECS.find((spec) => spec.id === id)?.durationMs ?? 60_000;
    const cutoff = now - durationMs;
    const aggregated = emptyBucket(0);
    for (const bucket of this.buckets) {
      if (bucket.t + TRAFFIC_BUCKET_MS <= cutoff) {
        continue;
      }
      aggregated.requests += bucket.requests;
      aggregated.bytesIn += bucket.bytesIn;
      aggregated.bytesOut += bucket.bytesOut;
      aggregated.wsMessagesIn += bucket.wsMessagesIn;
      aggregated.wsMessagesOut += bucket.wsMessagesOut;
      aggregated.busMessagesIn += bucket.busMessagesIn;
      aggregated.busMessagesOut += bucket.busMessagesOut;
      mergeDimMaps(aggregated.http, bucket.http);
      mergeDimMaps(aggregated.rpc, bucket.rpc);
      mergeDimMaps(aggregated.invoke, bucket.invoke);
      mergeDimMaps(aggregated.event, bucket.event);
      mergeDimMaps(aggregated.byDeviceKind, bucket.byDeviceKind);
    }
    const observedMs = Math.min(durationMs, Math.max(1, now - this.startedAtMs));
    const sec = observedMs / 1000;
    return {
      durationMs,
      requests: aggregated.requests,
      bytesIn: aggregated.bytesIn,
      bytesOut: aggregated.bytesOut,
      wsMessagesIn: aggregated.wsMessagesIn,
      wsMessagesOut: aggregated.wsMessagesOut,
      busMessagesIn: aggregated.busMessagesIn,
      busMessagesOut: aggregated.busMessagesOut,
      bytesInPerSec: aggregated.bytesIn / sec,
      bytesOutPerSec: aggregated.bytesOut / sec,
      requestsPerSec: aggregated.requests / sec,
      httpByRoute: rankDims(aggregated.http),
      rpcByMethod: rankDims(aggregated.rpc),
      invokeByChannel: rankDims(aggregated.invoke),
      eventByKind: rankDims(aggregated.event),
      byDeviceKind: rankDims(aggregated.byDeviceKind),
    };
  }

  private currentBucket(): Bucket {
    const now = this.clock();
    const t = Math.floor(now / TRAFFIC_BUCKET_MS) * TRAFFIC_BUCKET_MS;
    const last = this.buckets[this.buckets.length - 1];
    if (last && last.t === t) {
      return last;
    }
    const bucket = emptyBucket(t);
    this.buckets.push(bucket);
    this.pruneBuckets(now);
    return bucket;
  }

  private pruneBuckets(now: number): void {
    const cutoff = now - TRAFFIC_MAX_BUCKETS * TRAFFIC_BUCKET_MS;
    while (this.buckets.length > 0) {
      const first = this.buckets[0];
      if (!first || first.t >= cutoff) {
        break;
      }
      this.buckets.shift();
    }
    while (this.buckets.length > TRAFFIC_MAX_BUCKETS) {
      this.buckets.shift();
    }
  }
}

/** Process-wide meter; instanceId is set from server config at startup. */
export const trafficMeter = new TrafficMeter();
