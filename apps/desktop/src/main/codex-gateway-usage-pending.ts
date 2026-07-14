import type { GatewayCodexRequestKind, GatewayUsageEvent } from "@eco/gateway";

export const DEFAULT_CODEX_GATEWAY_USAGE_PENDING_TTL_MS = 30_000;
export const DEFAULT_CODEX_GATEWAY_USAGE_PENDING_MAX_EVENTS = 256;

export type CodexGatewayUsagePendingDropReason = "capacity_overflow" | "expired" | "shutdown";

export interface CodexGatewayUsagePendingEntry {
  event: GatewayUsageEvent;
  codexThreadId: string;
  turnId: string;
  requestKind: GatewayCodexRequestKind;
  enqueuedAtMs: number;
  expiresAtMs: number;
}

export interface CodexGatewayUsagePendingDrop extends CodexGatewayUsagePendingEntry {
  reason: CodexGatewayUsagePendingDropReason;
  droppedAtMs: number;
}

export type CodexGatewayUsagePendingEnqueueResult =
  | {
      status: "queued";
      entry: CodexGatewayUsagePendingEntry;
      pendingCount: number;
    }
  | {
      status: "rejected";
      reason: "invalid_turn_metadata";
    };

export interface CodexGatewayUsagePendingBufferOptions {
  ttlMs?: number;
  maxEvents?: number;
  now?: () => number;
  onDrop?: (drop: CodexGatewayUsagePendingDrop) => void;
}

/**
 * Holds raw Gateway events only until the persisted Codex thread attribution arrives.
 * It deliberately does not infer an Eco thread, parent, or billing role.
 */
export class CodexGatewayUsagePendingBuffer {
  private readonly ttlMs: number;
  private readonly maxEvents: number;
  private readonly now: () => number;
  private readonly onDrop: ((drop: CodexGatewayUsagePendingDrop) => void) | undefined;
  private readonly entriesByThread = new Map<string, CodexGatewayUsagePendingEntry[]>();
  private expiryTimer: ReturnType<typeof setTimeout> | undefined;
  private entryCount = 0;

  constructor(options: CodexGatewayUsagePendingBufferOptions = {}) {
    this.ttlMs = positiveInteger(options.ttlMs ?? DEFAULT_CODEX_GATEWAY_USAGE_PENDING_TTL_MS, "ttlMs");
    this.maxEvents = positiveInteger(
      options.maxEvents ?? DEFAULT_CODEX_GATEWAY_USAGE_PENDING_MAX_EVENTS,
      "maxEvents",
    );
    this.now = options.now ?? Date.now;
    this.onDrop = options.onDrop;
  }

  get size(): number {
    return this.entryCount;
  }

  enqueue(event: GatewayUsageEvent): CodexGatewayUsagePendingEnqueueResult {
    const identity = readValidTurnIdentity(event);
    if (!identity) {
      return { status: "rejected", reason: "invalid_turn_metadata" };
    }

    const now = this.now();
    this.removeExpired(now);
    while (this.entryCount >= this.maxEvents) {
      const oldest = this.oldestEntry();
      if (!oldest) {
        break;
      }
      this.removeEntry(oldest.codexThreadId, oldest.entry);
      this.onDrop?.({
        ...oldest.entry,
        reason: "capacity_overflow",
        droppedAtMs: now,
      });
    }

    const entry: CodexGatewayUsagePendingEntry = {
      event,
      ...identity,
      enqueuedAtMs: now,
      expiresAtMs: now + this.ttlMs,
    };
    const threadEntries = this.entriesByThread.get(identity.codexThreadId) ?? [];
    threadEntries.push(entry);
    this.entriesByThread.set(identity.codexThreadId, threadEntries);
    this.entryCount += 1;
    this.scheduleExpiry();
    return { status: "queued", entry, pendingCount: this.entryCount };
  }

  drain(codexThreadId: string): CodexGatewayUsagePendingEntry[] {
    const normalizedThreadId = codexThreadId.trim();
    if (!normalizedThreadId) {
      return [];
    }
    this.removeExpired(this.now());
    const entries = this.entriesByThread.get(normalizedThreadId);
    if (!entries) {
      this.scheduleExpiry();
      return [];
    }
    this.entriesByThread.delete(normalizedThreadId);
    this.entryCount -= entries.length;
    this.scheduleExpiry();
    return entries;
  }

  pruneExpired(): number {
    const removed = this.removeExpired(this.now());
    this.scheduleExpiry();
    return removed;
  }

  dispose(reason: CodexGatewayUsagePendingDropReason = "shutdown"): void {
    this.clearExpiryTimer();
    const droppedAtMs = this.now();
    for (const entries of this.entriesByThread.values()) {
      for (const entry of entries) {
        this.onDrop?.({ ...entry, reason, droppedAtMs });
      }
    }
    this.entriesByThread.clear();
    this.entryCount = 0;
  }

  private removeExpired(now: number): number {
    let removed = 0;
    for (const [codexThreadId, entries] of this.entriesByThread) {
      const live: CodexGatewayUsagePendingEntry[] = [];
      for (const entry of entries) {
        if (entry.expiresAtMs > now) {
          live.push(entry);
          continue;
        }
        removed += 1;
        this.entryCount -= 1;
        this.onDrop?.({ ...entry, reason: "expired", droppedAtMs: now });
      }
      if (live.length > 0) {
        this.entriesByThread.set(codexThreadId, live);
      } else {
        this.entriesByThread.delete(codexThreadId);
      }
    }
    return removed;
  }

  private oldestEntry(): { codexThreadId: string; entry: CodexGatewayUsagePendingEntry } | undefined {
    let oldest: { codexThreadId: string; entry: CodexGatewayUsagePendingEntry } | undefined;
    for (const [codexThreadId, entries] of this.entriesByThread) {
      for (const entry of entries) {
        if (!oldest || entry.enqueuedAtMs < oldest.entry.enqueuedAtMs) {
          oldest = { codexThreadId, entry };
        }
      }
    }
    return oldest;
  }

  private removeEntry(codexThreadId: string, entry: CodexGatewayUsagePendingEntry): void {
    const entries = this.entriesByThread.get(codexThreadId);
    if (!entries) {
      return;
    }
    const index = entries.indexOf(entry);
    if (index < 0) {
      return;
    }
    entries.splice(index, 1);
    this.entryCount -= 1;
    if (entries.length === 0) {
      this.entriesByThread.delete(codexThreadId);
    }
  }

  private scheduleExpiry(): void {
    this.clearExpiryTimer();
    let nextExpiry = Number.POSITIVE_INFINITY;
    for (const entries of this.entriesByThread.values()) {
      for (const entry of entries) {
        nextExpiry = Math.min(nextExpiry, entry.expiresAtMs);
      }
    }
    if (!Number.isFinite(nextExpiry)) {
      return;
    }
    const delayMs = Math.max(0, nextExpiry - this.now());
    this.expiryTimer = setTimeout(() => {
      this.expiryTimer = undefined;
      this.removeExpired(this.now());
      this.scheduleExpiry();
    }, delayMs);
    this.expiryTimer.unref?.();
  }

  private clearExpiryTimer(): void {
    if (this.expiryTimer) {
      clearTimeout(this.expiryTimer);
      this.expiryTimer = undefined;
    }
  }
}

function readValidTurnIdentity(event: GatewayUsageEvent):
  | {
      codexThreadId: string;
      turnId: string;
      requestKind: GatewayCodexRequestKind;
    }
  | undefined {
  const metadata = event.codexTurnMetadata;
  const codexThreadId = metadata?.threadId.trim();
  const turnId = metadata?.turnId.trim();
  const requestKind = metadata?.requestKind;
  if (
    !codexThreadId ||
    !turnId ||
    (requestKind !== "turn" && requestKind !== "prewarm" && requestKind !== "compaction")
  ) {
    return undefined;
  }
  return { codexThreadId, turnId, requestKind };
}

function positiveInteger(value: number, field: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Codex Gateway pending usage ${field} must be a positive integer.`);
  }
  return value;
}
