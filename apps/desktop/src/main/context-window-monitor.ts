import {
  computeOccupancyRatio,
  computeWindowOccupancy,
  DEFAULT_CONTEXT_LIMIT,
  effectiveContextLimit,
  occupancyPercent,
  type ParsedUsage,
} from "@eco/runtime";
import type {
  AgentRole,
  ModelsDevMapping,
  RouteManualSpec,
  RuntimeAgentRole,
  ThreadContextSnapshot,
} from "../shared/ipc";
import type { ModelsDevPricingCache } from "./models-dev-pricing-cache";
import { logEcoDiagThrottled, shortThreadId, snapshotContextFields } from "./eco-diag-log";

const COMPACT_COOLDOWN_MS = 60_000;
const DEFAULT_COMPACT_THRESHOLD = 0.85;

const ROLE_ORDER: readonly AgentRole[] = ["planner", "explore", "architect", "coder", "reviewer", "tester"];
const ROLE_ORDER_INDEX = new Map<string, number>(ROLE_ORDER.map((role, index) => [role, index]));

export interface ContextMonitorRoleSnapshot {
  role: RuntimeAgentRole;
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
  displayRole?: RuntimeAgentRole;
  roles: ContextMonitorRoleSnapshot[];
  instances: ThreadContextSnapshot["instances"];
}

interface RoleOccupancyState {
  occupied: number;
  modelId?: string;
  providerBaseUrl?: string;
  modelsDevMapping?: ModelsDevMapping;
  manualSpec?: RouteManualSpec;
  /** Nominal catalog context window shown in the UI. */
  limit: number;
  /** Effective limit for autocompact threshold (excludes buffer and output reserve). */
  compactLimit?: number;
  limitsResolved: boolean;
  maxOutputTokens?: number;
}

interface ThreadMonitorState {
  byRole: Partial<Record<RuntimeAgentRole, RoleOccupancyState>>;
  byInstance: Map<string, RoleOccupancyState & { role: RuntimeAgentRole; updatedAt: number }>;
  displayRole: RuntimeAgentRole;
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
      role?: RuntimeAgentRole;
      agentId?: string;
      modelId?: string;
      providerBaseUrl?: string;
      modelsDevMapping?: ModelsDevMapping;
      manualSpec?: RouteManualSpec;
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
    const manualSpec = options?.manualSpec ?? prev?.manualSpec;
    const next: RoleOccupancyState = {
      occupied: occupancy,
      limit: prev?.limit ?? DEFAULT_CONTEXT_LIMIT,
      limitsResolved: prev?.limitsResolved ?? false,
      ...(prev?.compactLimit !== undefined && { compactLimit: prev.compactLimit }),
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
    if (manualSpec) {
      next.manualSpec = manualSpec;
    }
    const subagentAgentId = options?.agentId && role !== "planner" ? options.agentId : undefined;
    if (subagentAgentId) {
      state.byInstance.set(subagentAgentId, {
        role,
        updatedAt: Date.now(),
        ...next,
      });
    } else {
      state.byRole[role] = next;
    }

    await this.refreshLimitForRole(next);
    if (subagentAgentId) {
      const instance = state.byInstance.get(subagentAgentId);
      if (instance) {
        instance.occupied = occupancy;
        instance.limit = next.limit;
        instance.limitsResolved = next.limitsResolved;
        if (next.compactLimit !== undefined) {
          instance.compactLimit = next.compactLimit;
        } else {
          delete instance.compactLimit;
        }
        if (next.maxOutputTokens !== undefined) {
          instance.maxOutputTokens = next.maxOutputTokens;
        } else {
          delete instance.maxOutputTokens;
        }
      }
    }
    this.refreshDisplayRole(state);
    const snapshot = this.toSnapshot(state);
    const prevOccupied = subagentAgentId
      ? state.byInstance.get(subagentAgentId)?.occupied
      : prev?.occupied;
    logEcoDiagThrottled(`context:${threadId}`, "context.update", {
      threadId: shortThreadId(threadId),
      role,
      agentId: subagentAgentId ? subagentAgentId.slice(-12) : null,
      target: subagentAgentId ? "instance" : "role",
      occupied: occupancy,
      prevOccupied: prevOccupied ?? null,
      displayRole: state.displayRole,
      snapshot: snapshotContextFields(snapshot),
    });
    return snapshot;
  }

  async updateOccupied(
    threadId: string,
    role: RuntimeAgentRole,
    occupied: number,
    options?: { limit?: number },
  ): Promise<ContextMonitorSnapshot> {
    const state = this.getOrCreateState(threadId);
    const prev = state.byRole[role];
    const nominalLimit = options?.limit ?? prev?.limit ?? DEFAULT_CONTEXT_LIMIT;
    const next: RoleOccupancyState = {
      occupied,
      limit: nominalLimit,
      limitsResolved: prev?.limitsResolved ?? false,
      ...(prev?.modelId && { modelId: prev.modelId }),
      ...(prev?.providerBaseUrl && { providerBaseUrl: prev.providerBaseUrl }),
      ...(prev?.modelsDevMapping && { modelsDevMapping: prev.modelsDevMapping }),
      ...(prev?.manualSpec && { manualSpec: prev.manualSpec }),
      ...(prev?.maxOutputTokens !== undefined && { maxOutputTokens: prev.maxOutputTokens }),
    };
    if (options?.limit !== undefined) {
      next.compactLimit = effectiveContextLimit(nominalLimit, next.maxOutputTokens);
    } else if (prev?.compactLimit !== undefined) {
      next.compactLimit = prev.compactLimit;
    }
    state.byRole[role] = next;
    if (prev?.modelId && prev?.providerBaseUrl && options?.limit === undefined) {
      await this.refreshLimitForRole(next);
    }
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

  isCompactInFlight(threadId: string): boolean {
    return this.states.get(threadId)?.compactInFlight ?? false;
  }

  markCompactInFlight(threadId: string): void {
    const state = this.getOrCreateState(threadId);
    state.compactInFlight = true;
  }

  beginCompactIfIdle(threadId: string): boolean {
    const state = this.getOrCreateState(threadId);
    if (state.compactInFlight) {
      return false;
    }
    state.compactInFlight = true;
    return true;
  }

  clearCompactInFlight(threadId: string): void {
    const state = this.states.get(threadId);
    if (state) {
      state.compactInFlight = false;
    }
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
    for (const role of Object.keys(state.byRole)) {
      if (role !== "planner") {
        delete state.byRole[role];
      }
    }
    state.byInstance.clear();
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

  getRoleOccupancy(threadId: string, role: RuntimeAgentRole): number {
    return this.states.get(threadId)?.byRole[role]?.occupied ?? 0;
  }

  getInstanceOccupancy(
    threadId: string,
    agentId: string,
  ):
    | {
        role: RuntimeAgentRole;
        occupied: number;
        limit: number;
        compactLimit: number;
        limitsResolved: boolean;
      }
    | undefined {
    const state = this.states.get(threadId);
    if (!state) {
      return undefined;
    }
    const instance = state.byInstance.get(agentId);
    if (!instance) {
      return undefined;
    }
    return {
      role: instance.role,
      occupied: instance.occupied,
      limit: instance.limit,
      compactLimit: compactLimitForRole(instance),
      limitsResolved: instance.limitsResolved,
    };
  }

  shouldHandoffSubagentResume(
    threadId: string,
    agentId: string,
    role: RuntimeAgentRole,
    threshold = DEFAULT_COMPACT_THRESHOLD,
  ): boolean {
    const instance = this.getInstanceOccupancy(threadId, agentId);
    if (instance && instance.limitsResolved) {
      if (instance.occupied >= instance.limit) {
        return true;
      }
      const { atThreshold } = computeOccupancyRatio(
        instance.occupied,
        instance.compactLimit,
        threshold,
      );
      return atThreshold;
    }

    const state = this.states.get(threadId);
    const roleState = state?.byRole[role];
    if (!roleState || !roleState.limitsResolved || roleState.occupied <= 0) {
      return false;
    }
    if (roleState.occupied >= roleState.limit) {
      return true;
    }
    const { atThreshold } = computeOccupancyRatio(
      roleState.occupied,
      compactLimitForRole(roleState),
      threshold,
    );
    return atThreshold;
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
    const { atThreshold } = computeOccupancyRatio(
      planner.occupied,
      compactLimitForRole(planner),
      threshold,
    );
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
    for (const role of Object.keys(state.byRole)) {
      if (role !== "planner") {
        delete state.byRole[role];
      }
    }
    for (const [agentId, instance] of state.byInstance.entries()) {
      if (instance.role !== "planner") {
        state.byInstance.delete(agentId);
      }
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
      const maxOutputTokens = roleSnapshot.maxOutputTokens ?? prev?.maxOutputTokens;
      state.byRole[roleSnapshot.role] = {
        occupied: roleSnapshot.occupied,
        limit: roleSnapshot.limit,
        compactLimit:
          prev?.compactLimit ?? effectiveContextLimit(roleSnapshot.limit, maxOutputTokens),
        limitsResolved: roleSnapshot.limitsResolved,
        ...(roleSnapshot.modelId && { modelId: roleSnapshot.modelId }),
        ...(maxOutputTokens !== undefined && { maxOutputTokens }),
        ...(prev?.providerBaseUrl && { providerBaseUrl: prev.providerBaseUrl }),
        ...(prev?.modelsDevMapping && { modelsDevMapping: prev.modelsDevMapping }),
        ...(prev?.manualSpec && { manualSpec: prev.manualSpec }),
      };
    }
    state.byInstance.clear();
    for (const instance of snapshot.instances ?? []) {
      if (!instance.agentId) {
        continue;
      }
      state.byInstance.set(instance.agentId, {
        role: instance.role,
        occupied: instance.occupied,
        limit: instance.limit,
        compactLimit: effectiveContextLimit(instance.limit, instance.maxOutputTokens),
        limitsResolved: instance.limitsResolved,
        updatedAt: instance.updatedAt,
        ...(instance.modelId && { modelId: instance.modelId }),
        ...(instance.maxOutputTokens !== undefined && { maxOutputTokens: instance.maxOutputTokens }),
      });
    }
    state.displayRole = snapshot.displayRole ?? "planner";
    this.refreshDisplayRole(state);
  }

  private getOrCreateState(threadId: string): ThreadMonitorState {
    let state = this.states.get(threadId);
    if (!state) {
      state = {
        byRole: {},
        byInstance: new Map(),
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
    let maxRole: RuntimeAgentRole | undefined;
    for (const role of sortRuntimeRoles(Object.keys(state.byRole))) {
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
      roleState.manualSpec?.contextTokens,
      roleState.manualSpec?.maxOutputTokens,
    );
    roleState.limit = resolved.limit;
    roleState.compactLimit = effectiveContextLimit(resolved.limit, resolved.maxOutputTokens);
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
      instances: this.toInstanceSnapshots(state),
      ...(active?.modelId && { modelId: active.modelId }),
      ...(active?.maxOutputTokens !== undefined && { maxOutputTokens: active.maxOutputTokens }),
    };
  }

  private toRoleSnapshots(state: ThreadMonitorState): ContextMonitorRoleSnapshot[] {
    return sortRuntimeRoles(Object.keys(state.byRole)).flatMap((role) => {
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

  private toInstanceSnapshots(state: ThreadMonitorState): ThreadContextSnapshot["instances"] {
    const instances = [...state.byInstance.entries()]
      .filter(([, instance]) => instance.occupied > 0)
      .map(([agentId, instance]) => ({
        agentId,
        role: instance.role,
        occupied: instance.occupied,
        limit: instance.limit,
        occupancyPct: occupancyPercent(instance.occupied, instance.limit),
        limitsResolved: instance.limitsResolved,
        segments: [fallbackSegment(instance.occupied)],
        updatedAt: instance.updatedAt,
        ...(instance.modelId && { modelId: instance.modelId }),
        ...(instance.maxOutputTokens !== undefined && { maxOutputTokens: instance.maxOutputTokens }),
      }));
    return instances.sort((left, right) => right.occupied - left.occupied);
  }
}

function compactLimitForRole(roleState: RoleOccupancyState): number {
  if (roleState.compactLimit !== undefined && roleState.compactLimit > 0) {
    return roleState.compactLimit;
  }
  return effectiveContextLimit(roleState.limit, roleState.maxOutputTokens);
}

function sortRuntimeRoles(roles: Iterable<RuntimeAgentRole>): RuntimeAgentRole[] {
  return [...roles].sort((left, right) => {
    const leftOrder = ROLE_ORDER_INDEX.get(left) ?? Number.MAX_SAFE_INTEGER;
    const rightOrder = ROLE_ORDER_INDEX.get(right) ?? Number.MAX_SAFE_INTEGER;
    if (leftOrder !== rightOrder) {
      return leftOrder - rightOrder;
    }
    return left.localeCompare(right);
  });
}

function fallbackSegment(tokens: number): ThreadContextSnapshot["segments"][number] {
  return {
    key: "conversation",
    label: "会话",
    tokens,
    color: "#ea580c",
  };
}
