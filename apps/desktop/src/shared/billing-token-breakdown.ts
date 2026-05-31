import { formatRoleModelLabel, formatUsageBadge, shortenModelId } from "@eco/runtime";
import { AGENT_ROLES, type AgentRole, type ThreadBillingSnapshot } from "./ipc";

export interface BillingAgentRow {
  role: AgentRole;
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
  roles: AgentRole[];
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

export function buildBillingTokenBreakdown(
  billing: ThreadBillingSnapshot | undefined,
): BillingTokenBreakdown | null {
  if (!billing?.byRole) {
    return null;
  }

  const byAgent: BillingAgentRow[] = [];
  for (const role of AGENT_ROLES) {
    const entry = billing.byRole[role];
    if (!entry || roleUsageTotal(entry) <= 0) {
      continue;
    }
    byAgent.push({
      role,
      label: formatRoleModelLabel(role, entry.modelId),
      ...(entry.modelId && { modelId: entry.modelId }),
      inputTokens: entry.inputTokens,
      outputTokens: entry.outputTokens,
      cacheReadTokens: entry.cacheReadTokens,
      cacheCreationTokens: entry.cacheCreationTokens,
      ecoCostUsd: entry.ecoCostUsd,
      tokenBadge: toTokenBadge(entry),
    });
  }

  if (byAgent.length === 0) {
    return null;
  }

  const modelMap = new Map<
    string,
    {
      modelId: string;
      roles: AgentRole[];
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
      roles: entry.roles,
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
