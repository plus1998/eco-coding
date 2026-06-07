import { formatRoleModelLabel, formatUsageBadge, shortenModelId } from "@eco/runtime";
import {
  AGENT_ROLES,
  type BillingUsageSource,
  type RuntimeAgentRole,
  type ThreadBillingModelSnapshot,
  type ThreadBillingSnapshot,
} from "./ipc";

type RoleUsageEntry = NonNullable<ThreadBillingSnapshot["byRole"]>[string];

const SUPPLEMENTAL_SOURCE_ORDER: BillingUsageSource[] = ["otel", "proxy", "sdk"];
const ROLE_ORDER = new Map<string, number>(AGENT_ROLES.map((role, index) => [role, index]));

export interface BillingAgentRow {
  role: RuntimeAgentRole;
  label: string;
  modelId?: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  ecoCostUsd: number;
  tokenBadge: string;
}

export interface BillingModelRow {
  modelId: string;
  label: string;
  roles: RuntimeAgentRole[];
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  ecoCostUsd: number;
  tokenBadge: string;
}

export interface BillingTokenBreakdown {
  byAgent: BillingAgentRow[];
  byModel: BillingModelRow[];
}

function roleUsageTotal(entry: {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}): number {
  return entry.inputTokens + entry.outputTokens + entry.cacheReadTokens + entry.cacheCreationTokens;
}

/** Primary (non-subagent) agent rows use role · 主 to mirror subagent role · agentId labels. */
function formatPrimaryAgentLabel(role: RuntimeAgentRole): string {
  return `${formatRoleModelLabel(role)} · 主`;
}

function toTokenBadge(entry: {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}): string {
  return formatUsageBadge({
    inputTokens: entry.inputTokens,
    outputTokens: entry.outputTokens,
    cacheReadTokens: entry.cacheReadTokens,
    cacheCreationTokens: entry.cacheCreationTokens,
  });
}

function hasRoleUsage(entry: RoleUsageEntry | undefined): entry is NonNullable<RoleUsageEntry> {
  return Boolean(entry && (roleUsageTotal(entry) > 0 || entry.ecoCostUsd > 0));
}

/** Primary source drives headline byRole; fill missing roles from other sources without double-counting overlaps. */
function collectDisplayByRole(
  billing: ThreadBillingSnapshot,
): Partial<Record<RuntimeAgentRole, NonNullable<RoleUsageEntry>>> {
  const merged: Partial<Record<RuntimeAgentRole, NonNullable<RoleUsageEntry>>> = {};

  const mergeEntries = (entries: ThreadBillingSnapshot["byRole"] | undefined) => {
    for (const [role, entry] of Object.entries(entries ?? {})) {
      if (merged[role]) {
        continue;
      }
      if (hasRoleUsage(entry)) {
        merged[role] = entry;
      }
    }
  };

  mergeEntries(billing.byRole);

  if (billing.sourceBreakdown) {
    for (const source of SUPPLEMENTAL_SOURCE_ORDER) {
      if (source === billing.primarySource) {
        continue;
      }
      mergeEntries(billing.sourceBreakdown[source]?.byRole);
    }
  }

  return merged;
}

function sortRoleKeys(roles: Iterable<string>): string[] {
  return [...roles].sort((left, right) => {
    const leftOrder = ROLE_ORDER.get(left) ?? Number.MAX_SAFE_INTEGER;
    const rightOrder = ROLE_ORDER.get(right) ?? Number.MAX_SAFE_INTEGER;
    if (leftOrder !== rightOrder) {
      return leftOrder - rightOrder;
    }
    return left.localeCompare(right);
  });
}

function collectDisplayByModel(billing: ThreadBillingSnapshot): ThreadBillingModelSnapshot[] {
  const modelMap = new Map<string, ThreadBillingModelSnapshot>();

  const addModel = (entry: ThreadBillingModelSnapshot) => {
    if (roleUsageTotal(entry) <= 0 && entry.ecoCostUsd <= 0) {
      return;
    }
    if (!modelMap.has(entry.modelId)) {
      modelMap.set(entry.modelId, { ...entry, roles: [...entry.roles] });
    }
  };

  for (const entry of billing.byModel ?? []) {
    addModel(entry);
  }

  if (billing.sourceBreakdown) {
    for (const source of SUPPLEMENTAL_SOURCE_ORDER) {
      if (source === billing.primarySource) {
        continue;
      }
      for (const entry of billing.sourceBreakdown[source]?.byModel ?? []) {
        addModel(entry);
      }
    }
  }

  return [...modelMap.values()].sort((left, right) => {
    const tokenDiff = roleUsageTotal(right) - roleUsageTotal(left);
    return tokenDiff !== 0 ? tokenDiff : left.modelId.localeCompare(right.modelId);
  });
}

function toModelRows(entries: ThreadBillingModelSnapshot[]): BillingModelRow[] {
  return entries.map((entry) => ({
    modelId: entry.modelId,
    label: shortenModelId(entry.modelId),
    roles: sortRoleKeys(entry.roles),
    inputTokens: entry.inputTokens,
    outputTokens: entry.outputTokens,
    cacheReadTokens: entry.cacheReadTokens,
    cacheCreationTokens: entry.cacheCreationTokens,
    ecoCostUsd: entry.ecoCostUsd,
    tokenBadge: toTokenBadge(entry),
  }));
}

export function buildBillingTokenBreakdown(
  billing: ThreadBillingSnapshot | undefined,
): BillingTokenBreakdown | null {
  if (!billing) {
    return null;
  }

  const displayByRole = collectDisplayByRole(billing);
  const displayByModelEntries = collectDisplayByModel(billing);

  const byAgent: BillingAgentRow[] = [];
  for (const role of sortRoleKeys(Object.keys(displayByRole))) {
    const entry = displayByRole[role];
    if (!entry) {
      continue;
    }
    byAgent.push({
      role,
      label: formatPrimaryAgentLabel(role),
      ...(entry.modelId && { modelId: entry.modelId }),
      inputTokens: entry.inputTokens,
      outputTokens: entry.outputTokens,
      cacheReadTokens: entry.cacheReadTokens,
      cacheCreationTokens: entry.cacheCreationTokens,
      ecoCostUsd: entry.ecoCostUsd,
      tokenBadge: toTokenBadge(entry),
    });
  }

  if (byAgent.length === 0 && displayByModelEntries.length === 0) {
    return null;
  }

  if (displayByModelEntries.length > 0) {
    return { byAgent, byModel: toModelRows(displayByModelEntries) };
  }

  const modelMap = new Map<
    string,
    {
      modelId: string;
      roles: RuntimeAgentRole[];
      inputTokens: number;
      outputTokens: number;
      cacheReadTokens: number;
      cacheCreationTokens: number;
      ecoCostUsd: number;
    }
  >();

  for (const row of byAgent) {
    const key = row.modelId?.trim() || row.role;
    const existing = modelMap.get(key);
    if (existing) {
      existing.roles.push(row.role);
      existing.inputTokens += row.inputTokens;
      existing.outputTokens += row.outputTokens;
      existing.cacheReadTokens += row.cacheReadTokens;
      existing.cacheCreationTokens += row.cacheCreationTokens;
      existing.ecoCostUsd += row.ecoCostUsd;
      continue;
    }
    modelMap.set(key, {
      modelId: key,
      roles: [row.role],
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
      cacheReadTokens: row.cacheReadTokens,
      cacheCreationTokens: row.cacheCreationTokens,
      ecoCostUsd: row.ecoCostUsd,
    });
  }

  const byModel: BillingModelRow[] = [...modelMap.values()]
    .map((entry) => ({
      modelId: entry.modelId,
      label: shortenModelId(entry.modelId),
      roles: sortRoleKeys(entry.roles),
      inputTokens: entry.inputTokens,
      outputTokens: entry.outputTokens,
      cacheReadTokens: entry.cacheReadTokens,
      cacheCreationTokens: entry.cacheCreationTokens,
      ecoCostUsd: entry.ecoCostUsd,
      tokenBadge: toTokenBadge(entry),
    }))
    .sort((left, right) => roleUsageTotal(right) - roleUsageTotal(left));

  return { byAgent, byModel };
}
