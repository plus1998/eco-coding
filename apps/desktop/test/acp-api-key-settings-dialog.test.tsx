import { expect, test } from "bun:test";
import { createElement } from "react";
import { AcpApiKeySettingsDialog } from "../src/renderer/AcpApiKeySettingsDialog";
import { DefaultAgentSettingsPanel } from "../src/renderer/DefaultAgentSettingsPanel";
import { renderLocalized } from "./i18n-test";

test("API key dialog renders input, hint, cancel and save", () => {
  const markup = renderLocalized(
    createElement(AcpApiKeySettingsDialog, {
      onSave: () => undefined,
      onClose: () => undefined,
    }),
    "zh-CN",
  );

  expect(markup).toContain('id="acp-cursor-api-key"');
  expect(markup).toContain("用于无法浏览器登录的环境");
  expect(markup).toContain("取消");
  expect(markup).toContain("保存");
});

test("API key dialog pre-fills the current key", () => {
  const markup = renderLocalized(
    createElement(AcpApiKeySettingsDialog, {
      currentKey: "ck-test-123",
      onSave: () => undefined,
      onClose: () => undefined,
    }),
    "zh-CN",
  );

  expect(markup).toContain('value="ck-test-123"');
});

test("panel shows API key entry with configured / not-set state", () => {
  const notSet = renderLocalized(
    createElement(DefaultAgentSettingsPanel, {
      defaultCoreKind: "acp",
      codexAvailable: true,
      onChange: () => undefined,
    }),
    "zh-CN",
  );
  expect(notSet).toContain("Cursor API Key");
  expect(notSet).toContain("未设置");

  const set = renderLocalized(
    createElement(DefaultAgentSettingsPanel, {
      defaultCoreKind: "acp",
      codexAvailable: true,
      acpCursorApiKey: "ck-test-123",
      onChange: () => undefined,
    }),
    "zh-CN",
  );
  expect(set).toContain("已配置");
});

test("panel opens the API key dialog on demand", () => {
  const markup = renderLocalized(
    createElement(DefaultAgentSettingsPanel, {
      defaultCoreKind: "acp",
      codexAvailable: true,
      acpCursorApiKey: "ck-test-123",
      initialApiKeySettingsOpen: true,
      onChange: () => undefined,
    }),
    "zh-CN",
  );

  expect(markup).toContain("acp-api-key-settings-modal");
  expect(markup).toContain('value="ck-test-123"');
});
