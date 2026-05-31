import {
  computeOccupancyRatio,
  computeWindowOccupancy,
  DEFAULT_CONTEXT_LIMIT,
  occupancyPercent,
  type ParsedUsage,
} from "@eco/runtime";
import type { AgentRole, ModelsDevMapping, ThreadContextSnapshot } from "../shared/ipc";
import type { ModelsDevPricingCache } from "./models-dev-pricing-cache";

const COMPACT_COOLDOWN_MS = 60_000;
const DEFAULT_COMPACT_THRESHOLD = 0.85;

const SUBAGENT_ROLES: readonly AgentRole[] = ["explore", "coder", "architect", "reviewer", "tester"];

const ROLE_ORDER: readonly AgentRole[] = ["planner", "explore", "architect", "coder", "reviewer", "tester"];

export interface ContextMonitorRoleSnapshot {
  role: AgentRole;
  occupied: number;
  limit: number;
  ratio: number;
  occupancyPct: number;
  modelId?: string;
  limitsResolved: boolean;
  maxOutputTokens?: number;
}

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
  roles: ContextMonitorRoleSnapshot[];
}

interface RoleOccupancyState {
  occupied: number;
  modelId?: string;
  providerBaseUrl?: string;
  modelsDevMapping?: ModelsDevMapping;
  limit: number;
  limitsResolved: boolean;
  maxOutputTokens?: number;
}

interface ThreadMonitorState {
  byRole: Partial<Record<AgentRole, RoleOccupancyState>>;
  displayRole: AgentRole;
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
      modelsDevMapping?: ModelsDevMapping;
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
    const modelId = options?.modelId ?? prev?.modelId;
    const providerBaseUrl = options?.providerBaseUrl ?? prev?.providerBaseUrl;
    const modelsDevMapping = options?.modelsDevMapping ?? prev?.modelsDevMapping;
    const next: RoleOccupancyState = {
      occupied: occupancy,
      limit: prev?.limit ?? DEFAULT_CONTEXT_LIMIT,
      limitsResolved: prev?.limitsResolved ?? false,
      ...(prev?.maxOutputTokens !== undefined && { maxOutputTokens: prev.maxOutputTokens }),
    };
    if (modelId) {
      next.modelId = modelId;
    }
    if (providerBaseUrl) {
      next.providerBaseUrl = providerBaseUrl;
    }
    if (modelsDevMapping) {
      next.modelsDevMapping = modelsDevMapping;
    }
    state.byRole[role] = next;

    await this.refreshLimitForRole(next);
    this.refreshDisplayRole(state);
    return this.toSnapshot(state);
  }

  async setModelContext(
    threadId: string,
    modelId: string,
    providerBaseUrl: string,
  ): Promise<ContextMonitorSnapshot> {
    const state = this.getOrCreateState(threadId);
    const role = state.displayRole;
    const prev = state.byRole[role];
    const next: RoleOccupancyState = {
      occupied: prev?.occupied ?? 0,
      modelId,
      providerBaseUrl,
      limit: prev?.limit ?? DEFAULT_CONTEXT_LIMIT,
      limitsResolved: prev?.limitsResolved ?? false,
      ...(prev?.maxOutputTokens !== undefined && { maxOutputTokens: prev.maxOutputTokens }),
    };
    state.byRole[role] = next;
    await this.refreshLimitForRole(next);
    this.refreshDisplayRole(state);
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
      limit: planner?.limit ?? DEFAULT_CONTEXT_LIMIT,
      limitsResolved: planner?.limitsResolved ?? false,
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
    const planner = state.byRole.planner;
    if (!planner) {
      return false;
    }
    const { atThreshold } = computeOccupancyRatio(planner.occupied, planner.limit, threshold);
    return atThreshold;
  }

  clearThread(threadId: string): void {
    this.states.delete(threadId);
  }

  clearSubagentRoles(threadId: string): ContextMonitorSnapshot | undefined {
    const state = this.states.get(threadId);
    if (!state) {
      return undefined;
    }
    for (const role of SUBAGENT_ROLES) {
      delete state.byRole[role];
    }
    this.refreshDisplayRole(state);
    return this.toSnapshot(state);
  }

  /** Restore meter state after app restart (from persisted ThreadContextSnapshot). */
  restoreFromContextSnapshot(threadId: string, snapshot: ThreadContextSnapshot): void {
    const state = this.getOrCreateState(threadId);
    const roles =
      snapshot.roles && snapshot.roles.length > 0
        ? snapshot.roles
        : [
            {
              role: snapshot.displayRole ?? "planner",
              occupied: snapshot.occupied,
              limit: snapshot.limit,
              occupancyPct: snapshot.occupancyPct,
              limitsResolved: snapshot.limitsResolved,
              segments: snapshot.segments,
              ...(snapshot.maxOutputTokens !== undefined && { maxOutputTokens: snapshot.maxOutputTokens }),
            },
          ];

    for (const roleSnapshot of roles) {
      const prev = state.byRole[roleSnapshot.role];
      state.byRole[roleSnapshot.role] = {
        occupied: roleSnapshot.occupied,
        limit: roleSnapshot.limit,
        limitsResolved: roleSnapshot.limitsResolved,
        ...(roleSnapshot.modelId && { modelId: roleSnapshot.modelId }),
        ...(roleSnapshot.maxOutputTokens !== undefined && { maxOutputTokens: roleSnapshot.maxOutputTokens }),
        ...(prev?.providerBaseUrl && { providerBaseUrl: prev.providerBaseUrl }),
        ...(prev?.modelsDevMapping && { modelsDevMapping: prev.modelsDevMapping }),
      };
    }
    state.displayRole = snapshot.displayRole ?? "planner";
    this.refreshDisplayRole(state);
  }

  private getOrCreateState(threadId: string): ThreadMonitorState {
    let state = this.states.get(threadId);
    if (!state) {
      state = {
        byRole: {},
        displayRole: "planner",
        seenMessageIds: new Set(),
        compactInFlight: false,
        lastCompactAt: 0,
      };
      this.states.set(threadId, state);
    }
    return state;
  }

  /** Prefer the planner main session when it exists; otherwise show the largest known child session. */
  private refreshDisplayRole(state: ThreadMonitorState): void {
    if ((state.byRole.planner?.occupied ?? 0) > 0) {
      state.displayRole = "planner";
      return;
    }

    let maxOccupied = 0;
    let maxRole: AgentRole | undefined;
    for (const role of ROLE_ORDER) {
      const occupied = state.byRole[role]?.occupied ?? 0;
      if (occupied > maxOccupied) {
        maxOccupied = occupied;
        maxRole = role;
      }
    }
    state.displayRole = maxRole ?? "planner";
  }

  private async refreshLimitForRole(roleState: RoleOccupancyState): Promise<void> {
    if (!roleState.modelId || !roleState.providerBaseUrl) {
      return;
    }
    const resolved = await this.pricingCache.resolveContextLimit(
      roleState.providerBaseUrl,
      roleState.modelId,
      roleState.modelsDevMapping,
    );
    roleState.limit = resolved.limit;
    roleState.limitsResolved = resolved.limitsResolved;
    if (resolved.maxOutputTokens !== undefined) {
      roleState.maxOutputTokens = resolved.maxOutputTokens;
    } else {
      delete roleState.maxOutputTokens;
    }
  }

  private toSnapshot(state: ThreadMonitorState): ContextMonitorSnapshot {
    const roles = this.toRoleSnapshots(state);
    const active = roles.find((role) => role.role === state.displayRole) ?? roles[0];
    const occupied = active?.occupied ?? 0;
    const limit = active?.limit ?? DEFAULT_CONTEXT_LIMIT;
    const { ratio } = computeOccupancyRatio(occupied, limit);
    return {
      occupied,
      limit,
      ratio,
      occupancyPct: occupancyPercent(occupied, limit),
      limitsResolved: active?.limitsResolved ?? false,
      displayRole: state.displayRole,
      roles,
      ...(active?.modelId && { modelId: active.modelId }),
      ...(active?.maxOutputTokens !== undefined && { maxOutputTokens: active.maxOutputTokens }),
    };
  }

  private toRoleSnapshots(state: ThreadMonitorState): ContextMonitorRoleSnapshot[] {
    return ROLE_ORDER.flatMap((role) => {
      const roleState = state.byRole[role];
      if (!roleState || roleState.occupied <= 0) {
        return [];
      }
      const { ratio } = computeOccupancyRatio(roleState.occupied, roleState.limit);
      return [
        {
          role,
          occupied: roleState.occupied,
          limit: roleState.limit,
          ratio,
          occupancyPct: occupancyPercent(roleState.occupied, roleState.limit),
          limitsResolved: roleState.limitsResolved,
          ...(roleState.modelId && { modelId: roleState.modelId }),
          ...(roleState.maxOutputTokens !== undefined && { maxOutputTokens: roleState.maxOutputTokens }),
        },
      ];
    });
  }
}
