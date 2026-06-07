import { expect, test } from "bun:test";
import type { ProviderConfigSecret } from "../src/main/provider-store";
import {
  buildDriverRoutes,
  buildDriverRoutesFromRuntime,
  resolveThreadRuntimeConfig,
  roleRoutesFromRuntime,
} from "../src/main/thread-runtime-routes";
import type { AgentRole, RoleRouteConfig } from "../src/shared/ipc";

function provider(id: string, enabled = true): ProviderConfigSecret {
  return {
    id,
    name: `Provider ${id}`,
    baseUrl: `https://${id}.example.test`,
    requestPath: "/v1/messages",
    apiCompat: "anthropic",
    defaultModel: "claude-test",
    enabled,
    hasApiKey: true,
    apiKeyPreview: "sk-...",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    apiKey: "secret",
  };
}

function routes(providerId = "p1"): RoleRouteConfig[] {
  const roles: AgentRole[] = ["planner", "explore", "architect", "coder", "reviewer", "tester"];
  return roles.map((role) => ({
    role,
    providerId,
    modelId: `${role}-model`,
    apiCompat: "anthropic",
    ...(role === "planner" ? { thinkingEffort: "high" as const } : {}),
  }));
}

test("resolveThreadRuntimeConfig validates full role routes and keeps route metadata", () => {
  const resolved = resolveThreadRuntimeConfig(
    { providers: [], routeProfiles: [], agentTemplates: [], orchestrationProfiles: [] },
    [provider("p1")],
    routes(),
  );

  expect(resolved.ok).toBe(true);
  if (!resolved.ok) return;
  expect(resolved.routes).toHaveLength(6);
  expect(resolved.routes[0]).toMatchObject({
    role: "planner",
    modelId: "planner-model",
    apiCompat: "anthropic",
    thinkingEffort: "high",
  });
  expect(roleRoutesFromRuntime(resolved.routes)[0]).toMatchObject({
    role: "planner",
    providerId: "p1",
    modelId: "planner-model",
    thinkingEffort: "high",
  });
});

test("resolveThreadRuntimeConfig reports missing providers and disabled providers", () => {
  expect(
    resolveThreadRuntimeConfig(
      { providers: [], routeProfiles: [], agentTemplates: [], orchestrationProfiles: [] },
      [],
      routes(),
    ).ok,
  ).toBe(false);
  expect(
    resolveThreadRuntimeConfig(
      { providers: [], routeProfiles: [], agentTemplates: [], orchestrationProfiles: [] },
      [provider("p1", false)],
      routes(),
    ),
  ).toEqual({
    ok: false,
    reason: 'Provider "Provider p1" for planner is disabled.',
  });
});

test("resolveThreadRuntimeConfig accepts partial routes for generic Agent Profiles", () => {
  const resolved = resolveThreadRuntimeConfig(
    { providers: [], routeProfiles: [], agentTemplates: [], orchestrationProfiles: [] },
    [provider("p1")],
    [{ role: "planner", providerId: "p1", modelId: "research-model" }],
    { requireCompleteCodingRoutes: false },
  );

  expect(resolved.ok).toBe(true);
  if (!resolved.ok) return;
  expect(resolved.routes).toHaveLength(1);
  expect(resolved.routes[0]?.role).toBe("planner");

  expect(
    resolveThreadRuntimeConfig(
      { providers: [], routeProfiles: [], agentTemplates: [], orchestrationProfiles: [] },
      [provider("p1")],
      [],
      { requireCompleteCodingRoutes: false },
    ),
  ).toEqual({
    ok: false,
    reason: "At least one model route is required for this Agent Profile.",
  });
});

test("resolveThreadRuntimeConfig still requires full coding routes by default", () => {
  expect(
    resolveThreadRuntimeConfig(
      { providers: [], routeProfiles: [], agentTemplates: [], orchestrationProfiles: [] },
      [provider("p1")],
      [{ role: "planner", providerId: "p1", modelId: "planner-model" }],
    ),
  ).toEqual({
    ok: false,
    reason: "Configure a explore route before starting a coding thread.",
  });
});

test("buildDriverRoutes uses proxy aliases while runtime routes use upstream model ids", () => {
  const resolved = resolveThreadRuntimeConfig(
    { providers: [], routeProfiles: [], agentTemplates: [], orchestrationProfiles: [] },
    [provider("p1")],
    routes(),
  );
  if (!resolved.ok) {
    throw new Error("expected runtime config");
  }
  const proxyRoutes = resolved.routes.map((route) => ({
    ...route,
    aliasModelId: `eco-${route.role}`,
  }));

  expect(buildDriverRoutes(proxyRoutes)[0]?.primary.modelId).toBe("eco-planner");
  expect(buildDriverRoutesFromRuntime(resolved.routes)[0]?.primary.modelId).toBe("planner-model");
});
