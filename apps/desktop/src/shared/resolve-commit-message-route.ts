import type { RoutePricingHint, RuntimeAgentRole, RuntimeRoleRouteConfig, SubagentRole } from "./ipc";
import { SUBAGENT_ROLES } from "./ipc";

export type CommitMessageRolePreference = RuntimeAgentRole | "auto";

const SUBAGENT_ROLE_PRIORITY: Record<SubagentRole, number> = {
  explore: 0,
  architect: 1,
  coder: 2,
  reviewer: 3,
  tester: 4,
};

function isSubagentRole(role: RuntimeAgentRole): role is SubagentRole {
  return (SUBAGENT_ROLES as readonly string[]).includes(role);
}

function rolePriority(role: RuntimeAgentRole): number {
  return isSubagentRole(role) ? SUBAGENT_ROLE_PRIORITY[role] : 99;
}

export function commitRoutePriceScore(hint: RoutePricingHint | undefined): number {
  if (!hint?.rates) {
    return Number.POSITIVE_INFINITY;
  }
  return hint.rates.inputPerM * 0.7 + hint.rates.outputPerM * 0.3;
}

export function listCommitMessageCandidateRoutes(
  routes: readonly RuntimeRoleRouteConfig[],
  enabledRoles: ReadonlySet<SubagentRole>,
): RuntimeRoleRouteConfig[] {
  return routes.filter((route) => route.role !== "planner" && isSubagentRole(route.role) && enabledRoles.has(route.role));
}

export function resolveDefaultCommitMessageRole(
  routes: readonly RuntimeRoleRouteConfig[],
  hints: readonly RoutePricingHint[],
  enabledRoles: ReadonlySet<SubagentRole>,
): RuntimeAgentRole | undefined {
  const candidates = listCommitMessageCandidateRoutes(routes, enabledRoles);
  if (candidates.length === 0) {
    return undefined;
  }
  const hintByRole = new Map(hints.map((hint) => [hint.role, hint]));
  const sorted = [...candidates].sort((left, right) => {
    const scoreDelta = commitRoutePriceScore(hintByRole.get(left.role)) - commitRoutePriceScore(hintByRole.get(right.role));
    if (scoreDelta !== 0) {
      return scoreDelta;
    }
    return rolePriority(left.role) - rolePriority(right.role);
  });
  return sorted[0]?.role;
}

export function resolveCommitMessageRoute(
  routes: readonly RuntimeRoleRouteConfig[],
  hints: readonly RoutePricingHint[],
  enabledRoles: ReadonlySet<SubagentRole>,
  savedRole?: CommitMessageRolePreference,
): RuntimeRoleRouteConfig | undefined {
  const candidates = listCommitMessageCandidateRoutes(routes, enabledRoles);
  if (candidates.length === 0) {
    return undefined;
  }
  if (savedRole && savedRole !== "auto") {
    const saved = candidates.find((route) => route.role === savedRole);
    if (saved) {
      return saved;
    }
  }
  const defaultRole = resolveDefaultCommitMessageRole(routes, hints, enabledRoles);
  return defaultRole ? candidates.find((route) => route.role === defaultRole) : candidates[0];
}
