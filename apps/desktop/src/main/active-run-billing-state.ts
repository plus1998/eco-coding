import type { AgentRole } from "../shared/ipc";
import type { UsageBillingObservation } from "./billing-orchestration";
import { appendUsageBillingObservation } from "./usage-billing-observations";

interface ActiveRunBillingState {
  otelRequestSeq?: number;
  proxyRequestSeq?: number;
  usageObservations: UsageBillingObservation[];
  lastProxyContextByRole: Partial<Record<AgentRole, number>>;
}

export class ActiveRunBillingStateStore {
  private readonly states = new Map<string, ActiveRunBillingState>();

  startRun(threadId: string): void {
    this.states.set(threadId, {
      usageObservations: [],
      lastProxyContextByRole: {},
    });
  }

  clearRun(threadId: string): void {
    this.states.delete(threadId);
  }

  hasRun(threadId: string): boolean {
    return this.states.has(threadId);
  }

  appendObservation(threadId: string, observation: UsageBillingObservation): boolean {
    const state = this.states.get(threadId);
    if (!state) {
      return false;
    }
    return appendUsageBillingObservation(state.usageObservations, observation);
  }

  listObservations(threadId: string): UsageBillingObservation[] | undefined {
    const observations = this.states.get(threadId)?.usageObservations;
    return observations && observations.length > 0 ? [...observations] : undefined;
  }

  otelRequestSeq(threadId: string): number | undefined {
    return this.states.get(threadId)?.otelRequestSeq;
  }

  recordOtelRequest(
    threadId: string,
    input: { nextRequestSeq: number },
  ): void {
    const state = this.states.get(threadId);
    if (!state) {
      return;
    }
    state.otelRequestSeq = input.nextRequestSeq;
  }

  proxyRequestSeq(threadId: string): number | undefined {
    return this.states.get(threadId)?.proxyRequestSeq;
  }

  recordProxyRequest(
    threadId: string,
    input: {
      nextRequestSeq: number;
      contextRole: AgentRole;
      contextOccupied: number;
    },
  ): void {
    const state = this.states.get(threadId);
    if (!state) {
      return;
    }
    state.proxyRequestSeq = input.nextRequestSeq;
    state.lastProxyContextByRole[input.contextRole] = input.contextOccupied;
  }

  proxyContextOccupied(threadId: string, role: AgentRole): number | undefined {
    return this.states.get(threadId)?.lastProxyContextByRole[role];
  }
}
