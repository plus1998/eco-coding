import { expect, test } from "bun:test";
import { createElement } from "react";
import { ComposerAcpModelTrigger } from "../src/renderer/ComposerAcpModelTrigger";
import { renderLocalized } from "./i18n-test";

const models = [
  { id: "claude-4-sonnet", displayName: "Sonnet 4", current: false, default: false },
  { id: "gpt-5.3-codex", displayName: "GPT-5.3 Codex", current: true, default: false },
];

test("ACP composer trigger uses the model trigger, not the orchestration empty state", () => {
  const markup = renderLocalized(
    createElement(ComposerAcpModelTrigger, {
      models,
      selectedModelId: "claude-4-sonnet",
      onChange: () => undefined,
    }),
    "zh-CN",
  );

  expect(markup).toContain("composer-model-trigger");
  expect(markup).toContain("Sonnet 4");
  expect(markup).not.toContain("选择编排组合");
  expect(markup).not.toContain("添加模型服务商");
  expect(markup).not.toContain("is-empty");
});

test("ACP composer trigger shows default label when no model is selected", () => {
  const markup = renderLocalized(
    createElement(ComposerAcpModelTrigger, {
      models,
      onChange: () => undefined,
    }),
    "zh-CN",
  );

  expect(markup).toContain("跟随当前默认模型");
});
