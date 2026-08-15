import { expect, test } from "bun:test";
import {
  ACP_MODEL_VENDOR_ICONS,
  ACP_MODEL_VENDORS,
  classifyAcpModelVendor,
  filterAcpModels,
  groupAcpModelsByVendor,
  resolveAcpComposerTriggerLabel,
} from "../src/shared/acp-model-vendor";

test("vendor catalog is Anthropic, GPT, Grok, Google, Other with icons", () => {
  expect(ACP_MODEL_VENDORS).toEqual(["anthropic", "gpt", "grok", "google", "other"]);
  expect(ACP_MODEL_VENDOR_ICONS.anthropic).toContain("claude-code.ico");
  expect(ACP_MODEL_VENDOR_ICONS.gpt).toContain("codex.ico");
  expect(ACP_MODEL_VENDOR_ICONS.grok).toContain("grok.ico");
  expect(ACP_MODEL_VENDOR_ICONS.google).toContain("gemini.png");
  expect(ACP_MODEL_VENDOR_ICONS.other).toContain("other.svg");
});

test("classifies Cursor-style model ids into vendor buckets", () => {
  expect(classifyAcpModelVendor({ id: "claude-4-sonnet" })).toBe("anthropic");
  expect(classifyAcpModelVendor({ id: "anthropic/claude-opus-4" })).toBe("anthropic");
  expect(classifyAcpModelVendor({ id: "gpt-5.3-codex" })).toBe("gpt");
  expect(classifyAcpModelVendor({ id: "openai-o3" })).toBe("gpt");
  expect(classifyAcpModelVendor({ id: "o4-mini" })).toBe("gpt");
  expect(classifyAcpModelVendor({ id: "grok-4" })).toBe("grok");
  expect(classifyAcpModelVendor({ id: "xai-grok-3" })).toBe("grok");
  expect(classifyAcpModelVendor({ id: "gemini-2.5-pro" })).toBe("google");
  expect(classifyAcpModelVendor({ id: "google/gemini-flash" })).toBe("google");
  expect(classifyAcpModelVendor({ id: "auto" })).toBe("other");
  expect(classifyAcpModelVendor({ id: "composer-1" })).toBe("other");
});

test("groups models by vendor and keeps unknown ids in Other", () => {
  const grouped = groupAcpModelsByVendor([
    { id: "claude-4-sonnet", displayName: "Sonnet 4" },
    { id: "gpt-5.3-codex", displayName: "Codex 5.3" },
    { id: "auto", displayName: "Auto" },
  ]);
  expect(grouped.anthropic.map((model) => model.id)).toEqual(["claude-4-sonnet"]);
  expect(grouped.gpt.map((model) => model.id)).toEqual(["gpt-5.3-codex"]);
  expect(grouped.grok).toEqual([]);
  expect(grouped.google).toEqual([]);
  expect(grouped.other.map((model) => model.id)).toEqual(["auto"]);
});

test("filters models by id or display name", () => {
  const models = [
    { id: "claude-4-sonnet", displayName: "Sonnet 4" },
    { id: "gpt-5.3-codex", displayName: "Codex 5.3" },
    { id: "auto", displayName: "Auto" },
  ];
  expect(filterAcpModels(models, "sonnet").map((model) => model.id)).toEqual(["claude-4-sonnet"]);
  expect(filterAcpModels(models, "GPT-5.3").map((model) => model.id)).toEqual(["gpt-5.3-codex"]);
  expect(filterAcpModels(models, "  ").map((model) => model.id)).toEqual([
    "claude-4-sonnet",
    "gpt-5.3-codex",
    "auto",
  ]);
});

test("ACP composer trigger prefers the selected model, then Cursor current, then default label", () => {
  const models = [
    { id: "claude-4-sonnet", displayName: "Sonnet 4", current: false },
    { id: "gpt-5.3-codex", displayName: "GPT-5.3 Codex", current: true },
  ];
  expect(resolveAcpComposerTriggerLabel(models, "claude-4-sonnet", "跟随当前默认模型")).toBe("Sonnet 4");
  expect(resolveAcpComposerTriggerLabel(models, "missing-id", "跟随当前默认模型")).toBe("missing-id");
  expect(resolveAcpComposerTriggerLabel(models, undefined, "跟随当前默认模型")).toBe("GPT-5.3 Codex");
  expect(resolveAcpComposerTriggerLabel([], undefined, "跟随当前默认模型")).toBe("跟随当前默认模型");
});
