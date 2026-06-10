import type { RuntimeAgentRole } from "../shared/ipc";
import type { UsageAttribution, UsageLedgerEvent } from "./usage-ledger";

export const PROXY_PENDING_ATTRIBUTION_REASON = "no_active_subagent";
export const PROXY_PENDING_TIMEOUT_REASON = "pending_agent_settlement_timeout";
export const USAGE_LEDGER_ROUTE_ROLE_METADATA_KEY = "routeRole";
export const USAGE_LEDGER_BILLING_ROLE_METADATA_KEY = "billingRole";
export const USAGE_LEDGER_ALIAS_MODEL_ID_METADATA_KEY = "aliasModelId";
export const USAGE_LEDGER_PROVIDER_ID_METADATA_KEY = "providerId";

export interface ProxyUsagePendingEntry {
  eventId: string;
  requestKey: string;
  routeRole: RuntimeAgentRole;
  billingRole: RuntimeAgentRole;
  observedAt: string;
}

export interface ProxyUsagePendingSettlementUpdate {
  eventId: string;
  agentId: string;
  attribution: UsageAttribution;
}

export class ProxyUsagePendingRegistry {
  private readonly byThread = new Map<string, ProxyUsagePendingEntry[]>();

  register(threadId: string, entry: ProxyUsagePendingEntry): void {
    const queue = this.byThread.get(threadId) ?? [];
    queue.push(entry);
    queue.sort((left, right) => left.observedAt.localeCompare(right.observedAt));
    this.byThread.set(threadId, queue);
  }

  consumeNextForRole(
    threadId: string,
    role: RuntimeAgentRole,
    agentId: string,
  ): ProxyUsagePendingSettlementUpdate | undefined {
    const queue = this.byThread.get(threadId);
    if (!queue || queue.length === 0) {
      return undefined;
    }
    const index = queue.findIndex((entry) => entry.billingRole === role);
    if (index < 0) {
      return undefined;
    }
    const [entry] = queue.splice(index, 1);
    if (!entry) {
      return undefined;
    }
    if (queue.length === 0) {
      this.byThread.delete(threadId);
    } else {
      this.byThread.set(threadId, queue);
    }
    return {
      eventId: entry.eventId,
      agentId,
      attribution: { status: "attributed", agentId },
    };
  }

  listPending(threadId: string): readonly ProxyUsagePendingEntry[] {
    return [...(this.byThread.get(threadId) ?? [])];
  }

  drainPending(threadId: string): ProxyUsagePendingEntry[] {
    const queue = this.byThread.get(threadId) ?? [];
    this.byThread.delete(threadId);
    return queue;
  }

  rebuildFromEvents(events: readonly UsageLedgerEvent[]): void {
    const threadIds = new Set(events.map((event) => event.threadId));
    for (const threadId of threadIds) {
      this.clearThread(threadId);
    }
    for (const event of events) {
      if (event.attribution.status !== "pending" || event.source !== "proxy") {
        continue;
      }
      this.register(event.threadId, {
        eventId: event.id,
        requestKey: event.requestKey ?? event.sourceEventId,
        routeRole: readRouteRole(event),
        billingRole: readBillingRole(event),
        observedAt: event.observedAt,
      });
    }
  }

  clearThread(threadId: string): void {
    this.byThread.delete(threadId);
  }
}

export function readRouteRole(event: UsageLedgerEvent): RuntimeAgentRole {
  const metadataRole = event.metadata?.[USAGE_LEDGER_ROUTE_ROLE_METADATA_KEY];
  return typeof metadataRole === "string" ? (metadataRole as RuntimeAgentRole) : event.role;
}

export function readBillingRole(event: UsageLedgerEvent): RuntimeAgentRole {
  const metadataRole = event.metadata?.[USAGE_LEDGER_BILLING_ROLE_METADATA_KEY];
  return typeof metadataRole === "string" ? (metadataRole as RuntimeAgentRole) : event.role;
}

export function isProxyPendingAttributionEvent(event: UsageLedgerEvent): boolean {
  return event.source === "proxy" && event.attribution.status === "pending";
}
