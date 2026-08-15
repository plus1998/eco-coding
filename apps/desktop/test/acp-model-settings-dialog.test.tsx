import { expect, test } from "bun:test";
import { createElement } from "react";
import { AcpModelSettingsDialog } from "../src/renderer/AcpModelSettingsDialog";
import { renderLocalized } from "./i18n-test";

const models = [
  { id: "claude-4-sonnet", displayName: "Sonnet 4", current: false, default: false },
  { id: "gpt-5.3-codex", displayName: "GPT-5.3 Codex", current: true, default: false },
  { id: "grok-4", displayName: "Grok 4", current: false, default: false },
  { id: "gemini-2.5-pro", displayName: "Gemini 2.5 Pro", current: false, default: false },
  { id: "auto", displayName: "Auto", current: false, default: true },
];

test("ACP model dialog is a left-right vendor cascade, not a system select", () => {
  const markup = renderLocalized(
    createElement(AcpModelSettingsDialog, {
      models,
      selectedModelId: "gpt-5.3-codex",
      onChange: () => undefined,
      onClose: () => undefined,
    }),
    "zh-CN",
  );

  expect(markup).toContain("acp-model-cascade");
  expect(markup).toContain("acp-model-cascade-vendors");
  expect(markup).toContain("acp-model-cascade-models");
  expect(markup).toContain("Anthropic");
  expect(markup).toContain("GPT");
  expect(markup).toContain("Grok");
  expect(markup).toContain("Google");
  expect(markup).toContain("其他");
  expect(markup).toContain("./agent-icons/claude-code.ico");
  expect(markup).toContain("./agent-icons/codex.ico");
  expect(markup).toContain("./agent-icons/grok.ico");
  expect(markup).toContain("./agent-icons/gemini.png");
  expect(markup).toContain("./agent-icons/other.svg");
  expect(markup).toContain("GPT-5.3 Codex");
  expect(markup).not.toContain("Sonnet 4");
  expect(markup).not.toContain("<select");
  expect(markup).toContain("跟随当前默认模型");
  expect(markup).toContain("acp-model-cascade-search");
  expect(markup).toContain('placeholder="搜索模型"');
});

test("ACP model dialog search lists matches across vendors", () => {
  const markup = renderLocalized(
    createElement(AcpModelSettingsDialog, {
      models,
      selectedModelId: "gpt-5.3-codex",
      initialQuery: "sonnet",
      onChange: () => undefined,
      onClose: () => undefined,
    }),
    "zh-CN",
  );

  expect(markup).toContain("Sonnet 4");
  expect(markup).not.toContain("GPT-5.3 Codex");
  expect(markup).not.toContain("Grok 4");
});

test("ACP model dialog opens the vendor that owns the selected model", () => {
  const markup = renderLocalized(
    createElement(AcpModelSettingsDialog, {
      models,
      selectedModelId: "claude-4-sonnet",
      onChange: () => undefined,
      onClose: () => undefined,
    }),
    "zh-CN",
  );

  expect(markup).toContain("Sonnet 4");
  expect(markup).not.toContain("GPT-5.3 Codex");
  expect(markup).toMatch(/acp-model-cascade-vendor is-selected[\s\S]*Anthropic/);
});
