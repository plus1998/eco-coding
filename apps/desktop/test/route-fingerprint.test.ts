import { expect, test } from "bun:test";
import {
  computeRouteFingerprint,
  routesMatchFingerprint,
} from "../src/shared/route-fingerprint";
import type { RoleRouteConfig, RuntimeRoleRouteConfig } from "../src/shared/ipc";

const sampleRoutes: RoleRouteConfig[] = [
  { role: "planner", providerId: "p1", modelId: "model-a" },
  { role: "coder", providerId: "p2", modelId: "model-b" },
  { role: "reviewer", providerId: "p1", modelId: "model-c" },
];

test("computeRouteFingerprint is stable for the same routes", () => {
  const first = computeRouteFingerprint(sampleRoutes);
  const second = computeRouteFingerprint([...sampleRoutes].reverse());
  expect(first).toBe(second);
});

test("routesMatchFingerprint detects provider or model changes", () => {
  const fingerprint = computeRouteFingerprint(sampleRoutes);
  expect(routesMatchFingerprint(sampleRoutes, fingerprint)).toBe(true);
  expect(
    routesMatchFingerprint(
      sampleRoutes.map((route) =>
        route.role === "planner" ? { ...route, providerId: "other" } : route,
      ),
      fingerprint,
    ),
  ).toBe(false);
});

test("routesMatchFingerprint includes dynamic runtime roles", () => {
  const routes: RuntimeRoleRouteConfig[] = [
    { role: "planner", providerId: "p1", modelId: "main" },
    { role: "researcher", providerId: "p1", modelId: "research-a" },
  ];
  const fingerprint = computeRouteFingerprint(routes);

  expect(routesMatchFingerprint([...routes].reverse(), fingerprint)).toBe(true);
  expect(
    routesMatchFingerprint(
      routes.map((route) =>
        route.role === "researcher" ? { ...route, modelId: "research-b" } : route,
      ),
      fingerprint,
    ),
  ).toBe(false);
});
