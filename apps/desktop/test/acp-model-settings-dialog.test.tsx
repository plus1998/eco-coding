import { expect, test } from "bun:test";
import { createElement } from "react";
import { AcpModelSettingsDialog } from "../src/renderer/AcpModelSettingsDialog";
import {
  createAcpCurrentExtra,
  mapAcpModelOptions,
  resolveAcpVendorNames,
} from "../src/renderer/model-cascade-options";
import {
  filterModelCascadeGroups,
  groupModelCascadeOptions,
} from "../src/renderer/ModelCascadeSelect";
import type { TFunction } from "i18next";
import { renderLocalized } from "./i18n-test";

const models = [
  { id: "claude-4-sonnet", displayName: "Sonnet 4", current: false, default: false },
  { id: "gpt-5.3-codex", displayName: "GPT-5.3 Codex", current: true, default: false },
  { id: "grok-4", displayName: "Grok 4", current: false, default: false },
  { id: "gemini-2.5-pro", displayName: "Gemini 2.5 Pro", current: false, default: false },
  { id: "auto", displayName: "Auto", current: false, default: true },
];

const zh = ((key: string) => key) as unknown as TFunction;

test("ACP model dialog uses the unified provider → model cascade, not a flat list", () => {
  const markup = renderLocalized(
    createElement(AcpModelSettingsDialog, {
      models,
      selectedModelId: "gpt-5.3-codex",
      onChange: () => undefined,
      onClose: () => undefined,
    }),
    "zh-CN",
  );

  expect(markup).toContain("acp-model-settings-body");
  expect(markup).toContain("model-cascade-trigger");
  // The trigger shows the committed selection, not a flat model list.
  expect(markup).toContain("GPT-5.3 Codex");
  expect(markup).not.toContain("model-cascade-provider-list");
  expect(markup).not.toContain("Sonnet 4");
  expect(markup).not.toContain("<select");
});

test("ACP model options are grouped by vendor, never flat", () => {
  const options = mapAcpModelOptions(models, resolveAcpVendorNames(zh));
  const groups = groupModelCascadeOptions(options);
  const byProvider = Object.fromEntries(groups.map((group) => [group.providerId, group]));
  expect(byProvider["anthropic"].options.map((option) => option.modelId)).toEqual([
    "claude-4-sonnet",
  ]);
  expect(byProvider["gpt"].options.map((option) => option.modelId)).toEqual(["gpt-5.3-codex"]);
  expect(byProvider["grok"].options.map((option) => option.modelId)).toEqual(["grok-4"]);
  expect(byProvider["google"].options.map((option) => option.modelId)).toEqual([
    "gemini-2.5-pro",
  ]);
  expect(byProvider["other"].options.map((option) => option.modelId)).toEqual(["auto"]);
  // Vendor icons ride along for the provider column.
  expect(byProvider["anthropic"].providerIcon).toBe("./agent-icons/claude-code.ico");
  expect(byProvider["gpt"].providerIcon).toBe("./agent-icons/codex.ico");
});

test("ACP cascade search keeps the provider → model hierarchy and filters across vendors", () => {
  const options = mapAcpModelOptions(models, resolveAcpVendorNames(zh));
  const groups = groupModelCascadeOptions(options);
  const searched = filterModelCascadeGroups(groups, "sonnet");
  expect(searched.map((group) => group.providerId)).toEqual(["anthropic"]);
  expect(searched[0].options.map((option) => option.modelId)).toEqual(["claude-4-sonnet"]);
  // Searching a vendor name keeps every model of that vendor.
  const byVendor = filterModelCascadeGroups(groups, "anthropic");
  expect(byVendor.map((group) => group.providerId)).toEqual(["anthropic"]);
  expect(byVendor[0].options.map((option) => option.modelId)).toEqual(["claude-4-sonnet"]);
  // No match leaves the catalogue empty, not a flat fallback list.
  expect(filterModelCascadeGroups(groups, "zzz")).toEqual([]);
});

test("ACP current-model extra marks only the active model", () => {
  const extra = createAcpCurrentExtra(models, "当前");
  const options = mapAcpModelOptions(models, resolveAcpVendorNames(zh));
  const byId = Object.fromEntries(options.map((option) => [option.modelId, option]));
  expect(extra(byId["gpt-5.3-codex"])).not.toBeNull();
  expect(extra(byId["claude-4-sonnet"])).toBeNull();
});
