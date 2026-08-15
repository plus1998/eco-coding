import { expect, test } from "bun:test";
import {
  DEFAULT_ACP_HOST_UI_FEATURES,
  isAcpHostUiFeatureVisible,
  normalizeAcpHostUiFeatures,
  resolveAcpHostUiFeatures,
} from "../src/acp-host-ui-features.js";

test("cursor hides context usage and billing", () => {
  expect(resolveAcpHostUiFeatures({ coreKind: "acp", acpAgentId: "cursor" })).toEqual({
    contextUsage: "hide",
    billing: "hide",
  });
});

test("non-acp cores show both columns", () => {
  for (const coreKind of ["claude", "codex", "pi"] as const) {
    expect(resolveAcpHostUiFeatures({ coreKind })).toEqual(DEFAULT_ACP_HOST_UI_FEATURES);
  }
});

test("unknown or missing acp agent defaults to show", () => {
  expect(resolveAcpHostUiFeatures({ coreKind: "acp" })).toEqual(DEFAULT_ACP_HOST_UI_FEATURES);
  expect(resolveAcpHostUiFeatures({ coreKind: "acp", acpAgentId: "other" })).toEqual(
    DEFAULT_ACP_HOST_UI_FEATURES,
  );
  expect(resolveAcpHostUiFeatures({ coreKind: "acp", acpAgentId: "  " })).toEqual(
    DEFAULT_ACP_HOST_UI_FEATURES,
  );
});

test("normalize missing object is all show", () => {
  expect(normalizeAcpHostUiFeatures(undefined)).toEqual(DEFAULT_ACP_HOST_UI_FEATURES);
  expect(normalizeAcpHostUiFeatures(null)).toEqual(DEFAULT_ACP_HOST_UI_FEATURES);
});

test("normalize dirty column falls back to show and keeps a valid hide", () => {
  expect(
    normalizeAcpHostUiFeatures({ contextUsage: "hide", billing: "nope" }),
  ).toEqual({ contextUsage: "hide", billing: "show" });
  expect(normalizeAcpHostUiFeatures({ contextUsage: "hide" })).toEqual({
    contextUsage: "hide",
    billing: "show",
  });
});

test("isAcpHostUiFeatureVisible treats missing features as show", () => {
  expect(isAcpHostUiFeatureVisible(undefined, "billing")).toBe(true);
  expect(
    isAcpHostUiFeatureVisible({ contextUsage: "hide", billing: "hide" }, "billing"),
  ).toBe(false);
});
