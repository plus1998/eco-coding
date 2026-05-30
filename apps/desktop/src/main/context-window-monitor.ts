import {
  computeOccupancyRatio,
  computeWindowOccupancy,
  DEFAULT_CONTEXT_LIMIT,
  occupancyPercent,
  type ParsedUsage,
} from "@eco/runtime";
import type { ModelsDevPricingCache } from "./models-dev-pricing-cache";

const COMPACT_COOLDOWN_MS = 60_000;
const DEFAULT_COMPACT_THRESHOLD = 0.85;

export interface ContextMonitorSnapshot {
  occupied: number;
  limit: number;
  ratio: number;
  occupancyPct: number;
  modelId?: string;
  limitsResolved: boolean;
  maxOutputTokens?: number;
}

interface ThreadMonitorState {
  occupied: number;
  limit: number;
  limitsResolved: boolean;
  maxOutputTokens?: number;
  modelId?: string;
  providerBaseUrl?: string;
  seenMessageIds: Set<string>;
  compactInFlight: boolean;
  lastCompactAt: number;
}

export class ContextWindowMonitor {
  private readonly states = new Map<string, ThreadMonitorState>();

  constructor(private readonly pricingCache: ModelsDevPricingCache) {}

  async updateFromUsage(
    threadId: string,
    usage: ParsedUsage,
    options?: { modelId?: string; providerBaseUrl?: string; messageId?: string },
  ): Promise<ContextMonitorSnapshot> {
    const state = this.getOrCreateState(threadId);
    const occupancy = computeWindowOccupancy(usage);

    if (options?.messageId) {
      if (state.seenMessageIds.has(options.messageId)) {
        return this.toSnapshot(state);
      }
      state.seenMessageIds.add(options.messageId);
    }

    if (occupancy > state.occupied) {
      state.occupied = occupancy;
    }

    if (options?.modelId) {
      state.modelId = options.modelId;
    }
    if (options?.providerBaseUrl) {
      state.providerBaseUrl = options.providerBaseUrl;
    }

    await this.refreshLimit(state);
    return this.toSnapshot(state);
  }

  async setModelContext(
    threadId: string,
    modelId: string,
    providerBaseUrl: string,
  ): Promise<ContextMonitorSnapshot> {
    const state = this.getOrCreateState(threadId);
    state.modelId = modelId;
    state.providerBaseUrl = providerBaseUrl;
    await this.refreshLimit(state);
    return this.toSnapshot(state);
  }

  markCompactInFlight(threadId: string): void {
    const state = this.getOrCreateState(threadId);
    state.compactInFlight = true;
  }

  markCompactCompleted(threadId: string, postTokens?: number): ContextMonitorSnapshot {
    const state = this.getOrCreateState(threadId);
    state.compactInFlight = false;
    state.lastCompactAt = Date.now();
    state.seenMessageIds.clear();
    if (postTokens !== undefined && Number.isFinite(postTokens)) {
      state.occupied = postTokens;
    } else {
      state.occupied = Math.round(state.occupied * 0.5);
    }
    return this.toSnapshot(state);
  }

  noteOtelCompaction(threadId: string): void {
    const state = this.states.get(threadId);
    if (state) {
      state.compactInFlight = true;
    }
  }

  getSnapshot(threadId: string): ContextMonitorSnapshot | undefined {
    const state = this.states.get(threadId);
    if (!state) {
      return undefined;
    }
    return this.toSnapshot(state);
  }

  shouldCompact(threadId: string, threshold = DEFAULT_COMPACT_THRESHOLD): boolean {
    const state = this.states.get(threadId);
    if (!state || state.compactInFlight) {
      return false;
    }
    if (Date.now() - state.lastCompactAt < COMPACT_COOLDOWN_MS) {
      return false;
    }
    const { atThreshold } = computeOccupancyRatio(state.occupied, state.limit, threshold);
    return atThreshold;
  }

  clearThread(threadId: string): void {
    this.states.delete(threadId);
  }

  private getOrCreateState(threadId: string): ThreadMonitorState {
    let state = this.states.get(threadId);
    if (!state) {
      state = {
        occupied: 0,
        limit: DEFAULT_CONTEXT_LIMIT,
        limitsResolved: false,
        seenMessageIds: new Set(),
        compactInFlight: false,
        lastCompactAt: 0,
      };
      this.states.set(threadId, state);
    }
    return state;
  }

  private async refreshLimit(state: ThreadMonitorState): Promise<void> {
    if (!state.modelId || !state.providerBaseUrl) {
      return;
    }
    const resolved = await this.pricingCache.resolveContextLimit(state.providerBaseUrl, state.modelId);
    state.limit = resolved.limit;
    state.limitsResolved = resolved.limitsResolved;
    state.maxOutputTokens = resolved.maxOutputTokens;
  }

  private toSnapshot(state: ThreadMonitorState): ContextMonitorSnapshot {
    const { ratio } = computeOccupancyRatio(state.occupied, state.limit);
    return {
      occupied: state.occupied,
      limit: state.limit,
      ratio,
      occupancyPct: occupancyPercent(state.occupied, state.limit),
      limitsResolved: state.limitsResolved,
      ...(state.modelId && { modelId: state.modelId }),
      ...(state.maxOutputTokens !== undefined && { maxOutputTokens: state.maxOutputTokens }),
    };
  }
}
