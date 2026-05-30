import {
  computeOccupancyRatio,
  computeWindowOccupancy,
  DEFAULT_CONTEXT_LIMIT,
  occupancyPercent,
  type ParsedUsage,
} from "@eco/runtime";
import type { AgentRole, ThreadContextSnapshot } from "../shared/ipc";
import type { ModelsDevPricingCache } from "./models-dev-pricing-cache";

const COMPACT_COOLDOWN_MS = 60_000;
const DEFAULT_COMPACT_THRESHOLD = 0.85;

const SUBAGENT_ROLES: readonly AgentRole[] = [
  "coder",
  "architect",
  "reviewer",
  "tester",
  "thinking",
];

export interface ContextMonitorSnapshot {
  occupied: number;
  limit: number;
  ratio: number;
  occupancyPct: number;
  modelId?: string;
  limitsResolved: boolean;
  maxOutputTokens?: number;
  /** Role whose occupancy is shown in the UI. */
  displayRole?: AgentRole;
}

interface RoleOccupancyState {
  occupied: number;
  modelId?: string;
  providerBaseUrl?: string;
}

interface ThreadMonitorState {
  byRole: Partial<Record<AgentRole, RoleOccupancyState>>;
  displayRole: AgentRole;
  limit: number;
  limitsResolved: boolean;
  maxOutputTokens?: number;
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
    options?: {
      role?: AgentRole;
      modelId?: string;
      providerBaseUrl?: string;
      messageId?: string;
    },
  ): Promise<ContextMonitorSnapshot> {
    const state = this.getOrCreateState(threadId);
    const role = options?.role ?? "planner";
    const occupancy = computeWindowOccupancy(usage);

    if (options?.messageId) {
      if (state.seenMessageIds.has(options.messageId)) {
        return this.toSnapshot(state);
      }
      state.seenMessageIds.add(options.messageId);
    }

    const prev = state.byRole[role];
    state.byRole[role] = {
      occupied: occupancy,
      modelId: options?.modelId ?? prev?.modelId,
      providerBaseUrl: options?.providerBaseUrl ?? prev?.providerBaseUrl,
    };

    this.refreshDisplayRole(state);
    await this.refreshLimitForDisplay(state);
    return this.toSnapshot(state);
  }

  async setModelContext(
    threadId: string,
    modelId: string,
    providerBaseUrl: string,
  ): Promise<ContextMonitorSnapshot> {
    const state = this.getOrCreateState(threadId);
    const role = state.displayRole;
    state.byRole[role] = {
      occupied: state.byRole[role]?.occupied ?? 0,
      modelId,
      providerBaseUrl,
    };
    await this.refreshLimitForDisplay(state);
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
    const planner = state.byRole.planner;
    const nextOccupied =
      postTokens !== undefined && Number.isFinite(postTokens)
        ? postTokens
        : Math.round((planner?.occupied ?? 0) * 0.5);
    state.byRole.planner = {
      ...planner,
      occupied: nextOccupied,
    };
    for (const role of SUBAGENT_ROLES) {
      delete state.byRole[role];
    }
    this.refreshDisplayRole(state);
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

  getRoleOccupancy(threadId: string, role: AgentRole): number {
    return this.states.get(threadId)?.byRole[role]?.occupied ?? 0;
  }

  shouldCompact(threadId: string, threshold = DEFAULT_COMPACT_THRESHOLD): boolean {
    const state = this.states.get(threadId);
    if (!state || state.compactInFlight) {
      return false;
    }
    if (Date.now() - state.lastCompactAt < COMPACT_COOLDOWN_MS) {
      return false;
    }
    const occupied = this.displayOccupancy(state);
    const { atThreshold } = computeOccupancyRatio(occupied, state.limit, threshold);
    return atThreshold;
  }

  clearThread(threadId: string): void {
    this.states.delete(threadId);
  }

  /** Restore meter state after app restart (from persisted ThreadContextSnapshot). */
  restoreFromContextSnapshot(threadId: string, snapshot: ThreadContextSnapshot): void {
    const state = this.getOrCreateState(threadId);
    const role = snapshot.displayRole ?? "planner";
    state.displayRole = role;
    state.limit = snapshot.limit;
    state.limitsResolved = snapshot.limitsResolved;
    if (snapshot.maxOutputTokens !== undefined) {
      state.maxOutputTokens = snapshot.maxOutputTokens;
    }
    state.byRole[role] = {
      occupied: snapshot.occupied,
      ...(state.byRole[role]?.modelId && { modelId: state.byRole[role]!.modelId }),
      ...(state.byRole[role]?.providerBaseUrl && { providerBaseUrl: state.byRole[role]!.providerBaseUrl }),
    };
  }

  private getOrCreateState(threadId: string): ThreadMonitorState {
    let state = this.states.get(threadId);
    if (!state) {
      state = {
        byRole: {},
        displayRole: "planner",
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

  /** Prefer subagent session fill during execution; otherwise planner (main session). */
  private refreshDisplayRole(state: ThreadMonitorState): void {
    let subMax = 0;
    let subRole: AgentRole | undefined;
    for (const role of SUBAGENT_ROLES) {
      const occupied = state.byRole[role]?.occupied ?? 0;
      if (occupied > subMax) {
        subMax = occupied;
        subRole = role;
      }
    }
    if (subRole && subMax > 0) {
      state.displayRole = subRole;
      return;
    }
    state.displayRole = "planner";
  }

  private displayOccupancy(state: ThreadMonitorState): number {
    return state.byRole[state.displayRole]?.occupied ?? 0;
  }

  private async refreshLimitForDisplay(state: ThreadMonitorState): Promise<void> {
    const active = state.byRole[state.displayRole];
    if (!active?.modelId || !active.providerBaseUrl) {
      return;
    }
    const resolved = await this.pricingCache.resolveContextLimit(
      active.providerBaseUrl,
      active.modelId,
    );
    state.limit = resolved.limit;
    state.limitsResolved = resolved.limitsResolved;
    state.maxOutputTokens = resolved.maxOutputTokens;
  }

  private toSnapshot(state: ThreadMonitorState): ContextMonitorSnapshot {
    const active = state.byRole[state.displayRole];
    const occupied = active?.occupied ?? 0;
    const { ratio } = computeOccupancyRatio(occupied, state.limit);
    return {
      occupied,
      limit: state.limit,
      ratio,
      occupancyPct: occupancyPercent(occupied, state.limit),
      limitsResolved: state.limitsResolved,
      displayRole: state.displayRole,
      ...(active?.modelId && { modelId: active.modelId }),
      ...(state.maxOutputTokens !== undefined && { maxOutputTokens: state.maxOutputTokens }),
    };
  }
}
