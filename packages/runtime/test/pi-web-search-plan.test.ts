import { test, expect } from "bun:test";
import {
  isIntegratedWebSearchConfigured,
  resolvePiWebSearchContext,
  resolvePiWebSearchPlan,
  resolveSupportsNativeWebSearch,
} from "../src/pi-web-search-plan.js";

test("resolveSupportsNativeWebSearch defaults to true", () => {
  expect(resolveSupportsNativeWebSearch(undefined)).toBe(true);
  expect(resolveSupportsNativeWebSearch({})).toBe(true);
  expect(resolveSupportsNativeWebSearch({ supportsNativeWebSearch: true })).toBe(true);
  expect(resolveSupportsNativeWebSearch({ supportsNativeWebSearch: false })).toBe(false);
});

test("resolvePiWebSearchPlan decision table", () => {
  expect(
    resolvePiWebSearchPlan({
      networkWebSearch: false,
      supportsNativeWebSearch: true,
      integratedSearchConfigured: true,
    }),
  ).toBe("none");

  expect(
    resolvePiWebSearchPlan({
      networkWebSearch: true,
      supportsNativeWebSearch: true,
      integratedSearchConfigured: false,
    }),
  ).toBe("native");

  expect(
    resolvePiWebSearchPlan({
      networkWebSearch: true,
      supportsNativeWebSearch: false,
      integratedSearchConfigured: true,
    }),
  ).toBe("integrated");

  expect(
    resolvePiWebSearchPlan({
      networkWebSearch: true,
      supportsNativeWebSearch: false,
      integratedSearchConfigured: false,
    }),
  ).toBe("none");
});

test("resolveWebSearchPlan aliases resolvePiWebSearchPlan", async () => {
  const { resolveWebSearchPlan } = await import("../src/pi-web-search-plan.js");
  expect(resolveWebSearchPlan).toBe(resolvePiWebSearchPlan);
});

test("isIntegratedWebSearchConfigured requires enabled + api key", () => {
  expect(isIntegratedWebSearchConfigured({ enabled: true, apiKey: "key" })).toBe(true);
  expect(isIntegratedWebSearchConfigured({ enabled: true, apiKey: "  " })).toBe(false);
  expect(isIntegratedWebSearchConfigured({ enabled: false, apiKey: "key" })).toBe(false);
});

test("resolvePiWebSearchContext passes integrated api key only for integrated backend", () => {
  expect(
    resolvePiWebSearchContext({
      networkWebSearch: true,
      supportsNativeWebSearch: false,
      integratedEnabled: true,
      integratedApiKey: " brave-key ",
    }),
  ).toEqual({ backend: "integrated", integratedApiKey: "brave-key" });

  expect(
    resolvePiWebSearchContext({
      networkWebSearch: true,
      supportsNativeWebSearch: true,
      integratedEnabled: true,
      integratedApiKey: "brave-key",
    }),
  ).toEqual({ backend: "native" });
});
