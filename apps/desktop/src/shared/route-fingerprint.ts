import { AGENT_ROLES, type RoleRouteConfig } from "./ipc";

/** Stable fingerprint for comparing route profiles across provider switches. */
export function computeRouteFingerprint(routes: readonly RoleRouteConfig[]): string {
  const byRole = new Map(routes.map((route) => [route.role, route]));
  return AGENT_ROLES.map((role) => {
    const route = byRole.get(role);
    if (!route) {
      return `${role}:`;
    }
    const compat = route.apiCompat ?? "";
    return `${role}:${route.providerId}:${route.modelId.trim()}:${compat}`;
  }).join("|");
}

export function routesMatchFingerprint(
  routes: readonly RoleRouteConfig[],
  fingerprint: string | undefined | null,
): boolean {
  if (!fingerprint) {
    return false;
  }
  return computeRouteFingerprint(routes) === fingerprint;
}
