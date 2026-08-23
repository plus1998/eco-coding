import { expect, test } from "bun:test";
import { ModelCascadeSelect, type ModelCascadeOption } from "../src/renderer/ModelCascadeSelect";
import { renderLocalized } from "./i18n-test";

const options: ModelCascadeOption[] = [
  {
    key: "openai::gpt-5",
    providerId: "openai",
    providerName: "OpenAI",
    modelId: "gpt-5",
    label: "GPT-5",
  },
  {
    key: "openai::gpt-5-mini",
    providerId: "openai",
    providerName: "OpenAI",
    modelId: "gpt-5-mini",
    label: "GPT-5 mini",
  },
  {
    key: "anthropic::claude",
    providerId: "anthropic",
    providerName: "Anthropic",
    modelId: "claude",
    label: "Claude",
  },
];

test("ModelCascadeSelect renders the committed provider · model label on the trigger", () => {
  const element = (
    <ModelCascadeSelect
      options={options}
      value={{ key: "openai::gpt-5", providerId: "openai", modelId: "gpt-5" }}
      onChange={() => undefined}
    />
  );
  const markup = renderLocalized(element, "zh-CN");
  expect(markup).toContain("model-cascade-trigger");
  expect(markup).toContain("OpenAI · GPT-5");
});

test("ModelCascadeSelect shows the placeholder when nothing is selected", () => {
  const element = (
    <ModelCascadeSelect options={options} onChange={() => undefined} placeholder="选择模型" />
  );
  const markup = renderLocalized(element, "zh-CN");
  expect(markup).toContain("选择模型");
  expect(markup).toContain("is-placeholder");
});

test("ModelCascadeSelect never renders a flat model list inline (hierarchy only opens in the panel)", () => {
  const element = (
    <ModelCascadeSelect options={options} onChange={() => undefined} placeholder="选择模型" />
  );
  const markup = renderLocalized(element, "en-US");
  // The trigger is closed by default: provider/model names are not listed flat.
  expect(markup).not.toContain("model-cascade-provider-list");
  expect(markup).not.toContain("model-cascade-model-list");
  expect(markup).not.toContain("Claude");
});

test("ModelCascadeSelect renders closed with a clearable auto-match placeholder", () => {
  // The panel opens on interaction; with nothing selected the trigger shows
  // the auto-match placeholder instead of a flat model list.
  const element = (
    <ModelCascadeSelect
      options={options}
      onChange={() => undefined}
      clearable
      clearLabel="Auto-match"
      placeholder="Auto-match"
    />
  );
  const markup = renderLocalized(element, "en-US");
  expect(markup).toContain("model-cascade-trigger");
  expect(markup).toContain("Auto-match");
  expect(markup).not.toContain("model-cascade-clear");
});
