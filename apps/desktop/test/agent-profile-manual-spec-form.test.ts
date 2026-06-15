import { expect, test } from "bun:test";
import {
  countManualOverrides,
  emptyManualSpecForm,
  formToManualSpec,
  listManualOverrideFields,
  manualSpecToForm,
  mergeEffectiveCapabilityHint,
  mergeEffectivePricingHint,
  tryFormToManualSpec,
} from "../src/renderer/agent-profile-manual-spec-form";
import type { RouteCapabilityHint, RoutePricingHint } from "../src/shared/ipc";

test("manualSpecToForm round-trips all fields", () => {
  const form = manualSpecToForm({
    contextTokens: 200_000,
    maxOutputTokens: 8_192,
    supportsImageInput: true,
    supportsReasoning: false,
    inputPerM: 3,
    outputPerM: 15,
    cacheReadPerM: 0.3,
    cacheWritePerM: 3.75,
  });
  expect(form.contextTokens).toBe("200000");
  expect(form.maxOutputTokens).toBe("8192");
  expect(form.supportsImageInput).toBe("yes");
  expect(form.supportsReasoning).toBe("no");
  expect(form.inputPerM).toBe("3");
  expect(form.outputPerM).toBe("15");
  expect(form.cacheReadPerM).toBe("0.3");
  expect(form.cacheWritePerM).toBe("3.75");
});

test("formToManualSpec strict validates token and rate fields", () => {
  const form = emptyManualSpecForm();
  form.contextTokens = "abc";
  expect(() => formToManualSpec(form, { strict: true })).toThrow("手动上下文上限必须是正整数");

  form.contextTokens = "128000";
  form.inputPerM = "bad";
  expect(() => formToManualSpec(form, { strict: true })).toThrow("输入价格必须是正数");
});

test("tryFormToManualSpec ignores invalid partial input", () => {
  const form = emptyManualSpecForm();
  form.contextTokens = "256,000";
  form.inputPerM = "3";
  expect(tryFormToManualSpec(form)).toEqual({ contextTokens: 256_000, inputPerM: 3 });
});

test("countManualOverrides and listManualOverrideFields", () => {
  const form = emptyManualSpecForm();
  form.contextTokens = "200000";
  form.supportsImageInput = "yes";
  form.outputPerM = "15";
  expect(countManualOverrides(form)).toBe(3);
  expect([...listManualOverrideFields(form)]).toEqual([
    "contextTokens",
    "supportsImageInput",
    "outputPerM",
  ]);
});

test("mergeEffectiveCapabilityHint prefers manual values", () => {
  const auto: RouteCapabilityHint = {
    role: "main",
    modelId: "vendor",
    providerName: "Vendor",
    supportsImageInput: false,
    supportsReasoning: false,
    capabilitiesResolved: true,
    contextTokens: 128_000,
    maxOutputTokens: 4_096,
    contextLimitResolved: true,
  };
  const merged = mergeEffectiveCapabilityHint(auto, {
    contextTokens: 256_000,
    supportsImageInput: true,
  });
  expect(merged?.contextTokens).toBe(256_000);
  expect(merged?.maxOutputTokens).toBe(4_096);
  expect(merged?.supportsImageInput).toBe(true);
  expect(merged?.supportsReasoning).toBe(false);
});

test("mergeEffectivePricingHint prefers manual input/output and merges cache", () => {
  const auto: RoutePricingHint = {
    role: "main",
    modelId: "vendor",
    providerName: "Vendor",
    rates: { inputPerM: 1, outputPerM: 2, cacheReadPerM: 0.1 },
    pricingResolved: true,
  };
  const merged = mergeEffectivePricingHint(auto, {
    inputPerM: 5,
    outputPerM: 10,
  });
  expect(merged?.rates).toEqual({ inputPerM: 5, outputPerM: 10, cacheReadPerM: 0.1 });
});
