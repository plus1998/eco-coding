import { randomUUID } from "node:crypto";

export interface ActiveRequestEntry {
  /** Immutable ECO logical request id — lifecycle and timeline correlation key. */
  logicalRequestId: string;
  /** Upstream provider request id metadata — never replaces logicalRequestId. */
  providerRequestId?: string;
  role: string;
  agentId?: string;
  /** When false, lifecycle runs but request.started/terminal timeline UI is suppressed. */
  emitTimelineActivity: boolean;
}

export interface FinalizedRequestAttribution {
  logicalRequestId: string;
  role: string;
  agentId?: string;
  emitTimelineActivity: boolean;
  providerRequestId?: string;
  finalizedAt: number;
  runAttemptId?: string;
}

export interface ThreadLiveRequestScope {
  role: string;
  agentId?: string;
  emitTimelineActivity?: boolean;
}

export interface BeginRequestResult {
  logicalRequestId: string;
  /** Same as logicalRequestId — timeline correlation id. */
  requestId: string;
  role: string;
  agentId?: string;
  emitTimelineActivity: boolean;
}

export type BindLogicalAgentIdResult =
  | {
      ok: true;
      agentId: string;
      /** True when agentId was upgraded from absent → known. */
      bound: boolean;
      source: "active" | "finalized";
      role: string;
      emitTimelineActivity: boolean;
      logicalRequestId: string;
    }
  | {
      ok: false;
      reason: "empty" | "missing" | "role_conflict" | "agent_conflict";
    };

const MAX_FINALIZED_PER_THREAD = 64;

/** Tracks active logical requests per thread for live timeline attribution. */
export class ThreadLiveRequestRegistry {
  private readonly activeByThread = new Map<string, ActiveRequestEntry[]>();
  private readonly finalizedByThread = new Map<string, FinalizedRequestAttribution[]>();

  beginRequest(threadId: string, input: ThreadLiveRequestScope): BeginRequestResult {
    const logicalRequestId = `req_${randomUUID()}`;
    const entry: ActiveRequestEntry = {
      logicalRequestId,
      role: input.role,
      emitTimelineActivity: input.emitTimelineActivity !== false,
      ...(input.agentId?.trim() && { agentId: input.agentId.trim() }),
    };
    this.append(threadId, entry);
    return {
      logicalRequestId: entry.logicalRequestId,
      requestId: entry.logicalRequestId,
      role: entry.role,
      emitTimelineActivity: entry.emitTimelineActivity,
      ...(entry.agentId ? { agentId: entry.agentId } : {}),
    };
  }

  listActive(threadId: string): readonly ActiveRequestEntry[] {
    return [...(this.activeByThread.get(threadId) ?? [])];
  }

  listFinalized(threadId: string): readonly FinalizedRequestAttribution[] {
    return [...(this.finalizedByThread.get(threadId) ?? [])];
  }

  findEntryByLogicalId(threadId: string, logicalRequestId: string): ActiveRequestEntry | undefined {
    const trimmed = logicalRequestId.trim();
    if (!trimmed) {
      return undefined;
    }
    return this.activeByThread.get(threadId)?.find((entry) => entry.logicalRequestId === trimmed);
  }

  findFinalizedByLogicalId(
    threadId: string,
    logicalRequestId: string,
  ): FinalizedRequestAttribution | undefined {
    const trimmed = logicalRequestId.trim();
    if (!trimmed) {
      return undefined;
    }
    return this.finalizedByThread.get(threadId)?.find((entry) => entry.logicalRequestId === trimmed);
  }

  resolveLogicalRequestId(threadId: string, logicalRequestId: string): string | undefined {
    const trimmed = logicalRequestId.trim();
    if (!trimmed) {
      return undefined;
    }
    return this.findEntryByLogicalId(threadId, trimmed)?.logicalRequestId;
  }

  recordProviderRequestIdByLogicalId(
    threadId: string,
    logicalRequestId: string,
    providerRequestId: string,
  ): boolean {
    const trimmedLogical = logicalRequestId.trim();
    const trimmedProvider = providerRequestId.trim();
    if (!trimmedLogical || !trimmedProvider) {
      return false;
    }
    const existing = this.findEntryByLogicalId(threadId, trimmedLogical);
    if (!existing) {
      return false;
    }
    if (existing.providerRequestId === trimmedProvider) {
      return false;
    }
    existing.providerRequestId = trimmedProvider;
    return true;
  }

  /**
   * Read-only compatibility check for exact late bind.
   * Same failure reasons as bindAgentId; does not mutate.
   */
  canBindAgentId(
    threadId: string,
    logicalRequestId: string,
    input: { agentId: string; role?: string },
  ): BindLogicalAgentIdResult {
    return this.inspectBind(threadId, logicalRequestId, input, false);
  }

  /**
   * Exact late bind: agentId may only upgrade absent → known.
   * Conflicting agentId or role fail closed. Never rekeys logicalRequestId.
   */
  bindAgentId(
    threadId: string,
    logicalRequestId: string,
    input: { agentId: string; role?: string },
  ): BindLogicalAgentIdResult {
    return this.inspectBind(threadId, logicalRequestId, input, true);
  }

  private inspectBind(
    threadId: string,
    logicalRequestId: string,
    input: { agentId: string; role?: string },
    mutate: boolean,
  ): BindLogicalAgentIdResult {
    const trimmedLogical = logicalRequestId.trim();
    const trimmedAgentId = input.agentId.trim();
    if (!trimmedLogical || !trimmedAgentId) {
      return { ok: false, reason: "empty" };
    }

    const active = this.findEntryByLogicalId(threadId, trimmedLogical);
    if (active) {
      return this.applyBindToMutable(active, trimmedAgentId, input.role, "active", trimmedLogical, mutate);
    }

    const finalized = this.findFinalizedByLogicalId(threadId, trimmedLogical);
    if (finalized) {
      return this.applyBindToMutable(
        finalized,
        trimmedAgentId,
        input.role,
        "finalized",
        trimmedLogical,
        mutate,
      );
    }

    return { ok: false, reason: "missing" };
  }

  /**
   * Move active entry to bounded finalized tombstone so late bind can still land after terminal.
   */
  moveToFinalized(
    threadId: string,
    logicalRequestId: string,
    options?: { runAttemptId?: string },
  ): FinalizedRequestAttribution | undefined {
    const entry = this.findEntryByLogicalId(threadId, logicalRequestId);
    if (!entry) {
      return undefined;
    }
    const tombstone: FinalizedRequestAttribution = {
      logicalRequestId: entry.logicalRequestId,
      role: entry.role,
      emitTimelineActivity: entry.emitTimelineActivity,
      finalizedAt: Date.now(),
      ...(entry.agentId ? { agentId: entry.agentId } : {}),
      ...(entry.providerRequestId ? { providerRequestId: entry.providerRequestId } : {}),
      ...(options?.runAttemptId?.trim() ? { runAttemptId: options.runAttemptId.trim() } : {}),
    };
    this.endRequest(threadId, entry.logicalRequestId);
    this.appendFinalized(threadId, tombstone);
    return tombstone;
  }

  resolve(threadId: string, input: { role?: string; agentId?: string }): string | undefined {
    const entries = this.activeByThread.get(threadId);
    if (!entries || entries.length === 0) {
      return undefined;
    }
    const agentId = input.agentId?.trim();
    if (agentId) {
      const byAgent = entries.filter((entry) => entry.agentId === agentId);
      return byAgent.length === 1 ? byAgent[0]!.logicalRequestId : undefined;
    }
    const role = input.role?.trim();
    if (!role) {
      return undefined;
    }
    const byRole = entries.filter((entry) => entry.role === role && !entry.agentId);
    return byRole.length === 1 ? byRole[0]!.logicalRequestId : undefined;
  }

  hasActiveRequestId(threadId: string, logicalRequestId: string): boolean {
    const trimmed = logicalRequestId.trim();
    if (!trimmed) {
      return false;
    }
    return (this.activeByThread.get(threadId) ?? []).some((entry) => entry.logicalRequestId === trimmed);
  }

  endRequest(threadId: string, logicalRequestId: string): void {
    const trimmed = logicalRequestId.trim();
    if (!trimmed) {
      return;
    }
    const entries = this.activeByThread.get(threadId);
    if (!entries) {
      return;
    }
    const next = entries.filter((entry) => entry.logicalRequestId !== trimmed);
    if (next.length === 0) {
      this.activeByThread.delete(threadId);
      return;
    }
    this.activeByThread.set(threadId, next);
  }

  clearFinalized(threadId: string, logicalRequestId?: string): void {
    if (logicalRequestId?.trim()) {
      const trimmed = logicalRequestId.trim();
      const entries = this.finalizedByThread.get(threadId);
      if (!entries) {
        return;
      }
      const next = entries.filter((entry) => entry.logicalRequestId !== trimmed);
      if (next.length === 0) {
        this.finalizedByThread.delete(threadId);
      } else {
        this.finalizedByThread.set(threadId, next);
      }
      return;
    }
    this.finalizedByThread.delete(threadId);
  }

  clearFinalizedForAttempt(threadId: string, runAttemptId: string): void {
    const trimmedAttempt = runAttemptId.trim();
    if (!trimmedAttempt) {
      return;
    }
    const entries = this.finalizedByThread.get(threadId);
    if (!entries) {
      return;
    }
    const next = entries.filter((entry) => entry.runAttemptId !== trimmedAttempt);
    if (next.length === 0) {
      this.finalizedByThread.delete(threadId);
    } else {
      this.finalizedByThread.set(threadId, next);
    }
  }

  clearThread(threadId: string): void {
    this.activeByThread.delete(threadId);
    this.finalizedByThread.delete(threadId);
  }

  private applyBindToMutable(
    entry: { role: string; agentId?: string; emitTimelineActivity: boolean },
    agentId: string,
    eventRole: string | undefined,
    source: "active" | "finalized",
    logicalRequestId: string,
    mutate = true,
  ): BindLogicalAgentIdResult {
    const trimmedEventRole = eventRole?.trim();
    if (trimmedEventRole && trimmedEventRole !== entry.role) {
      return { ok: false, reason: "role_conflict" };
    }
    if (entry.agentId && entry.agentId !== agentId) {
      return { ok: false, reason: "agent_conflict" };
    }
    const bound = !entry.agentId;
    if (mutate && bound) {
      entry.agentId = agentId;
    }
    return {
      ok: true,
      agentId,
      bound,
      source,
      role: entry.role,
      emitTimelineActivity: entry.emitTimelineActivity,
      logicalRequestId,
    };
  }

  private append(threadId: string, entry: ActiveRequestEntry): void {
    const entries = this.activeByThread.get(threadId) ?? [];
    this.activeByThread.set(threadId, [...entries, entry]);
  }

  private appendFinalized(threadId: string, entry: FinalizedRequestAttribution): void {
    const entries = this.finalizedByThread.get(threadId) ?? [];
    const withoutDup = entries.filter((candidate) => candidate.logicalRequestId !== entry.logicalRequestId);
    withoutDup.push(entry);
    while (withoutDup.length > MAX_FINALIZED_PER_THREAD) {
      withoutDup.shift();
    }
    this.finalizedByThread.set(threadId, withoutDup);
  }
}

export const THREAD_LIVE_REQUEST_MAX_FINALIZED_PER_THREAD = MAX_FINALIZED_PER_THREAD;
