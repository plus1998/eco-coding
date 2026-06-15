import type { RoutePricingHint, RoutePricingRates, RuntimeAgentRole, RuntimeRoleRouteConfig, SubagentRole } from "./ipc";
import { SUBAGENT_ROLES } from "./ipc";
import { commitRoutePriceScore, listCommitMessageCandidateRoutes } from "./resolve-commit-message-route";

export interface CommitModelOption {
  id: string;
  role: RuntimeAgentRole;
  providerName: string;
  modelId: string;
  modelLabel: string;
  providerColor: string;
  hint?: RoutePricingHint;
}

const PROVIDER_ACCENT: Record<string, string> = {
  anthropic: "#D97757",
  openai: "#10A37F",
  google: "#4285F4",
  gemini: "#4285F4",
  deepseek: "#4D6BFF",
  moonshot: "#6366F1",
  qwen: "#7C3AED",
  alibaba: "#FF6A00",
  zhipu: "#2563EB",
  glm: "#2563EB",
  meta: "#0866FF",
  mistral: "#F97316",
  groq: "#F43F5E",
};

function pricingSignature(rates?: RoutePricingRates): string {
  if (!rates) {
    return "unresolved";
  }
  return [
    rates.inputPerM,
    rates.outputPerM,
    rates.cacheReadPerM ?? "",
    rates.cacheWritePerM ?? "",
  ].join(":");
}

export function commitModelDedupeKey(
  providerName: string,
  modelId: string,
  hint?: RoutePricingHint,
): string {
  return `${providerName.trim().toLowerCase()}::${modelId.trim()}::${pricingSignature(hint?.rates)}`;
}

export function formatCommitModelDisplayName(modelId: string): string {
  const normalized = modelId.trim();
  if (!normalized) {
    return "未配置模型";
  }
  const short = normalized.includes("/") ? (normalized.split("/").pop() ?? normalized) : normalized;
  if (short.length <= 28) {
    return short;
  }
  return `${short.slice(0, 12)}…${short.slice(-12)}`;
}

export function resolveProviderAccentColor(providerName: string): string {
  const normalized = providerName.trim().toLowerCase();
  if (!normalized) {
    return "var(--popover-muted)";
  }
  for (const [key, color] of Object.entries(PROVIDER_ACCENT)) {
    if (normalized.includes(key)) {
      return color;
    }
  }
  let hash = 0;
  for (const char of normalized) {
    hash = (hash * 31 + char.charCodeAt(0)) | 0;
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue} 58% 52%)`;
}

function pickRepresentativeRole(
  routes: readonly RuntimeRoleRouteConfig[],
  hints: readonly RoutePricingHint[],
): RuntimeRoleRouteConfig {
  const hintByRole = new Map(hints.map((hint) => [hint.role, hint]));
  return [...routes].sort((left, right) => {
    const scoreDelta =
      commitRoutePriceScore(hintByRole.get(left.role)) - commitRoutePriceScore(hintByRole.get(right.role));
    if (scoreDelta !== 0) {
      return scoreDelta;
    }
    return SUBAGENT_ROLES.indexOf(left.role as SubagentRole) - SUBAGENT_ROLES.indexOf(right.role as SubagentRole);
  })[0]!;
}

export function buildCommitModelOptions(
  routes: readonly RuntimeRoleRouteConfig[],
  hints: readonly RoutePricingHint[],
  enabledRoles: ReadonlySet<SubagentRole>,
): CommitModelOption[] {
  const candidates = listCommitMessageCandidateRoutes(routes, enabledRoles);
  const hintByRole = new Map(hints.map((hint) => [hint.role, hint]));
  const groups = new Map<
    string,
    { routes: RuntimeRoleRouteConfig[]; hint?: RoutePricingHint; providerName: string }
  >();

  for (const route of candidates) {
    const hint = hintByRole.get(route.role);
    const providerName = hint?.providerName?.trim() || route.providerId;
    const key = commitModelDedupeKey(providerName, route.modelId, hint);
    const existing = groups.get(key);
    if (existing) {
      existing.routes.push(route);
      continue;
    }
    groups.set(key, { routes: [route], hint, providerName });
  }

  const options = [...groups.entries()].map(([id, group]) => {
    const representative = pickRepresentativeRole(group.routes, hints);
    const hint = group.hint ?? hintByRole.get(representative.role);
    const providerName = hint?.providerName?.trim() || group.providerName;
    const modelId = hint?.modelId?.trim() || representative.modelId;
    return {
      id,
      role: representative.role,
      providerName,
      modelId,
      modelLabel: formatCommitModelDisplayName(modelId),
      providerColor: resolveProviderAccentColor(providerName),
      ...(hint && { hint }),
    };
  });

  return options.sort(
    (left, right) => commitRoutePriceScore(left.hint) - commitRoutePriceScore(right.hint),
  );
}

export function findCommitModelOptionForRole(
  options: readonly CommitModelOption[],
  role: RuntimeAgentRole | undefined,
  routes: readonly RuntimeRoleRouteConfig[],
  hints: readonly RoutePricingHint[],
): CommitModelOption | undefined {
  if (!role) {
    return undefined;
  }
  const route = routes.find((entry) => entry.role === role);
  if (!route) {
    return options.find((option) => option.role === role);
  }
  const hint = hints.find((entry) => entry.role === role);
  const providerName = hint?.providerName?.trim() || route.providerId;
  const key = commitModelDedupeKey(providerName, route.modelId, hint);
  return options.find((option) => option.id === key) ?? options.find((option) => option.role === role);
}
