import type { RuntimeAgentRole } from "../shared/ipc";
import type { UsageAttribution, UsageLedgerEvent } from "./usage-ledger";

export const PROXY_PENDING_ATTRIBUTION_REASON = "missing_structured_agent_id";
export const PROXY_PENDING_PARENT_UNMAPPED_REASON = "parent_tool_use_unmapped";
export const PROXY_PENDING_TIMEOUT_REASON = "pending_agent_settlement_timeout";
export const USAGE_LEDGER_ROUTE_ROLE_METADATA_KEY = "routeRole";
export const USAGE_LEDGER_BILLING_ROLE_METADATA_KEY = "billingRole";
export const USAGE_LEDGER_ALIAS_MODEL_ID_METADATA_KEY = "aliasModelId";
export const USAGE_LEDGER_PROVIDER_ID_METADATA_KEY = "providerId";
export const USAGE_LEDGER_CONTEXT_UPDATE_METADATA_KEY = "contextUpdate";

export interface ProxyUsagePendingEntry {
  eventId: string;
  requestKey: string;
  routeRole: RuntimeAgentRole;
  billingRole: RuntimeAgentRole;
  observedAt: string;
  parentToolUseId?: string;
  messageId?: string;
}

export interface ProxyMessageIdentityBinding {
  messageId: string;
  agentId: string;
  role: RuntimeAgentRole;
  parentToolUseId?: string;
}

export interface ProxyUsagePendingSettlementUpdate {
  eventId: string;
  agentId: string;
  role: RuntimeAgentRole;
  attribution: UsageAttribution;
  messageId?: string;
  parentToolUseId?: string;
}

export interface ProxyMessageIdentityDiagnostic {
  reason:
    | "message_identity_conflict"
    | "pending_parent_tool_use_conflict";
  messageId: string;
  eventId?: string;
  existingAgentId?: string;
  incomingAgentId?: string;
  existingRole?: RuntimeAgentRole;
  incomingRole?: RuntimeAgentRole;
  existingParentToolUseId?: string;
  incomingParentToolUseId?: string;
}

export interface ProxyUsagePendingMutationResult {
  updates: ProxyUsagePendingSettlementUpdate[];
  diagnostics: ProxyMessageIdentityDiagnostic[];
  bindingStatus?: "bound" | "duplicate" | "conflict";
}

export class ProxyUsagePendingRegistry {
  private readonly byThread = new Map<string, ProxyUsagePendingEntry[]>();
  private readonly messageBindingsByThread = new Map<
    string,
    Map<string, ProxyMessageIdentityBinding>
  >();

  register(
    threadId: string,
    entry: ProxyUsagePendingEntry,
  ): ProxyUsagePendingMutationResult {
    const normalized = normalizePendingEntry(entry);
    const binding = normalized.messageId
      ? this.messageBindingsByThread.get(threadId)?.get(normalized.messageId)
      : undefined;
    if (binding) {
      return buildMutationForBoundEntry(normalized, binding);
    }

    const queue = this.byThread.get(threadId) ?? [];
    queue.push(normalized);
    queue.sort((left, right) =>
      left.observedAt.localeCompare(right.observedAt),
    );
    this.byThread.set(threadId, queue);
    return { updates: [], diagnostics: [] };
  }

  bindMessageIdentity(
    threadId: string,
    input: ProxyMessageIdentityBinding,
  ): ProxyUsagePendingMutationResult {
    const binding = normalizeMessageBinding(input);
    if (!binding) {
      return { updates: [], diagnostics: [] };
    }

    let bindings = this.messageBindingsByThread.get(threadId);
    if (!bindings) {
      bindings = new Map();
      this.messageBindingsByThread.set(threadId, bindings);
    }
    const existing = bindings.get(binding.messageId);
    if (existing) {
      const merged = mergeCompatibleBinding(existing, binding);
      if (!merged) {
        return {
          updates: [],
          diagnostics: [
            {
              reason: "message_identity_conflict",
              messageId: binding.messageId,
              existingAgentId: existing.agentId,
              incomingAgentId: binding.agentId,
              existingRole: existing.role,
              incomingRole: binding.role,
              ...(existing.parentToolUseId && {
                existingParentToolUseId: existing.parentToolUseId,
              }),
              ...(binding.parentToolUseId && {
                incomingParentToolUseId: binding.parentToolUseId,
              }),
            },
          ],
          bindingStatus: "conflict",
        };
      }
      bindings.set(binding.messageId, merged);
      return {
        ...this.consumeForMessageBinding(threadId, merged),
        bindingStatus: "duplicate",
      };
    }

    bindings.set(binding.messageId, binding);
    return {
      ...this.consumeForMessageBinding(threadId, binding),
      bindingStatus: "bound",
    };
  }

  consumeForParentToolUse(
    threadId: string,
    parentToolUseId: string,
    agentId: string,
    role?: RuntimeAgentRole,
  ): ProxyUsagePendingSettlementUpdate | undefined {
    const queue = this.byThread.get(threadId);
    if (!queue || queue.length === 0) {
      return undefined;
    }
    const parent = normalizeOptionalString(parentToolUseId);
    const normalizedAgentId = normalizeOptionalString(agentId);
    if (!parent || !normalizedAgentId) {
      return undefined;
    }
    const index = queue.findIndex((entry) => entry.parentToolUseId === parent);
    if (index < 0) {
      return undefined;
    }
    const [entry] = queue.splice(index, 1);
    if (!entry) {
      return undefined;
    }
    this.updateQueue(threadId, queue);
    return {
      eventId: entry.eventId,
      agentId: normalizedAgentId,
      role: role ?? entry.billingRole,
      attribution: { status: "attributed", agentId: normalizedAgentId },
      ...(entry.messageId && { messageId: entry.messageId }),
      parentToolUseId: parent,
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

  rebuildFromEvents(
    events: readonly UsageLedgerEvent[],
  ): ProxyUsagePendingMutationResult {
    const threadIds = new Set(events.map((event) => event.threadId));
    for (const threadId of threadIds) {
      this.byThread.delete(threadId);
    }

    const result: ProxyUsagePendingMutationResult = {
      updates: [],
      diagnostics: [],
    };
    for (const event of events) {
      if (event.attribution.status !== "pending" || event.source !== "proxy") {
        continue;
      }
      const mutation = this.register(event.threadId, {
        eventId: event.id,
        requestKey: event.requestKey ?? event.sourceEventId,
        routeRole: readRouteRole(event),
        billingRole: readBillingRole(event),
        observedAt: event.observedAt,
        ...(event.parentToolUseId && {
          parentToolUseId: event.parentToolUseId,
        }),
        ...(event.sdkMessageId && { messageId: event.sdkMessageId }),
      });
      result.updates.push(...mutation.updates);
      result.diagnostics.push(...mutation.diagnostics);
    }
    return result;
  }

  clearThread(threadId: string): void {
    this.byThread.delete(threadId);
    this.messageBindingsByThread.delete(threadId);
  }

  private consumeForMessageBinding(
    threadId: string,
    binding: ProxyMessageIdentityBinding,
  ): ProxyUsagePendingMutationResult {
    const queue = this.byThread.get(threadId);
    if (!queue || queue.length === 0) {
      return { updates: [], diagnostics: [] };
    }

    const consumed = queue.filter(
      (entry) => entry.messageId === binding.messageId,
    );
    if (consumed.length === 0) {
      return { updates: [], diagnostics: [] };
    }
    this.updateQueue(
      threadId,
      queue.filter((entry) => entry.messageId !== binding.messageId),
    );

    const result: ProxyUsagePendingMutationResult = {
      updates: [],
      diagnostics: [],
    };
    for (const entry of consumed) {
      const mutation = buildMutationForBoundEntry(entry, binding);
      result.updates.push(...mutation.updates);
      result.diagnostics.push(...mutation.diagnostics);
    }
    return result;
  }

  private updateQueue(threadId: string, queue: ProxyUsagePendingEntry[]): void {
    if (queue.length === 0) {
      this.byThread.delete(threadId);
    } else {
      this.byThread.set(threadId, queue);
    }
  }
}

export function readRouteRole(event: UsageLedgerEvent): RuntimeAgentRole {
  const metadataRole = event.metadata?.[USAGE_LEDGER_ROUTE_ROLE_METADATA_KEY];
  return typeof metadataRole === "string"
    ? (metadataRole as RuntimeAgentRole)
    : event.role;
}

export function readBillingRole(event: UsageLedgerEvent): RuntimeAgentRole {
  const metadataRole = event.metadata?.[USAGE_LEDGER_BILLING_ROLE_METADATA_KEY];
  return typeof metadataRole === "string"
    ? (metadataRole as RuntimeAgentRole)
    : event.role;
}

export function isProxyPendingAttributionEvent(
  event: UsageLedgerEvent,
): boolean {
  return event.source === "proxy" && event.attribution.status === "pending";
}

function normalizePendingEntry(
  entry: ProxyUsagePendingEntry,
): ProxyUsagePendingEntry {
  const {
    parentToolUseId: rawParentToolUseId,
    messageId: rawMessageId,
    ...rest
  } = entry;
  const parentToolUseId = normalizeOptionalString(rawParentToolUseId);
  const messageId = normalizeOptionalString(rawMessageId);
  return {
    ...rest,
    ...(parentToolUseId && { parentToolUseId }),
    ...(messageId && { messageId }),
  };
}

function normalizeMessageBinding(
  input: ProxyMessageIdentityBinding,
): ProxyMessageIdentityBinding | undefined {
  const messageId = normalizeOptionalString(input.messageId);
  const agentId = normalizeOptionalString(input.agentId);
  const role = normalizeOptionalString(input.role) as
    RuntimeAgentRole | undefined;
  const parentToolUseId = normalizeOptionalString(input.parentToolUseId);
  if (!messageId || !agentId || !role) {
    return undefined;
  }
  return {
    messageId,
    agentId,
    role,
    ...(parentToolUseId && { parentToolUseId }),
  };
}

function mergeCompatibleBinding(
  existing: ProxyMessageIdentityBinding,
  incoming: ProxyMessageIdentityBinding,
): ProxyMessageIdentityBinding | undefined {
  if (
    existing.agentId !== incoming.agentId ||
    existing.role !== incoming.role
  ) {
    return undefined;
  }
  if (
    existing.parentToolUseId &&
    incoming.parentToolUseId &&
    existing.parentToolUseId !== incoming.parentToolUseId
  ) {
    return undefined;
  }
  return {
    ...existing,
    ...(existing.parentToolUseId || incoming.parentToolUseId
      ? {
          parentToolUseId: existing.parentToolUseId ?? incoming.parentToolUseId,
        }
      : {}),
  };
}

function buildMutationForBoundEntry(
  entry: ProxyUsagePendingEntry,
  binding: ProxyMessageIdentityBinding,
): ProxyUsagePendingMutationResult {
  const diagnostics: ProxyMessageIdentityDiagnostic[] = [];
  if (
    entry.parentToolUseId &&
    binding.parentToolUseId &&
    entry.parentToolUseId !== binding.parentToolUseId
  ) {
    diagnostics.push({
      reason: "pending_parent_tool_use_conflict",
      messageId: binding.messageId,
      eventId: entry.eventId,
      incomingAgentId: binding.agentId,
      existingParentToolUseId: entry.parentToolUseId,
      incomingParentToolUseId: binding.parentToolUseId,
    });
  }
  return {
    updates: [
      {
        eventId: entry.eventId,
        agentId: binding.agentId,
        role: binding.role,
        attribution: { status: "attributed", agentId: binding.agentId },
        messageId: binding.messageId,
        ...(binding.parentToolUseId || entry.parentToolUseId
          ? {
              parentToolUseId: binding.parentToolUseId ?? entry.parentToolUseId,
            }
          : {}),
      },
    ],
    diagnostics,
  };
}

function normalizeOptionalString(
  value: string | undefined,
): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}
