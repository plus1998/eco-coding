import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { GeneralSettingsPanel } from "../src/renderer/GeneralSettingsPanel";
import { NotificationPreferencesPanel } from "../src/renderer/NotificationPreferencesPanel";
import { renderLocalized } from "./i18n-test";

test("appearance settings renders theme and typography controls in Chinese", () => {
  const markup = renderLocalized(
    createElement(GeneralSettingsPanel, {
      theme: "system",
      onThemeChange: () => undefined,
      typography: { uiFontSize: 14, codeFontSize: 12 },
      onTypographyChange: () => undefined,
    }),
    "zh-CN",
  );

  expect(markup).toContain("外观");
  expect(markup).toContain("主题");
  expect(markup).toContain("UI 字号");
  expect(markup).toContain("代码字体大小");
  expect(markup).not.toContain("语言");
  expect(markup).toContain("14<small>px</small>");
  expect(markup).toContain("12<small>px</small>");
  expect(markup).toContain('aria-label="减小UI 字号"');
  expect(markup).toContain('aria-label="增大代码字体大小"');
});

test("appearance settings renders English labels without language section", () => {
  const markup = renderLocalized(
    createElement(GeneralSettingsPanel, {
      theme: "light",
      onThemeChange: () => undefined,
      typography: { uiFontSize: 15, codeFontSize: 13 },
      onTypographyChange: () => undefined,
    }),
    "en-US",
  );

  expect(markup).toContain("Appearance");
  expect(markup).toContain("Theme");
  expect(markup).not.toContain("Language");
  expect(markup).toContain("UI font size");
  expect(markup).toContain('aria-label="Decrease UI font size"');
});

test("preferences panel puts language under the general section", () => {
  const markup = renderLocalized(
    createElement(NotificationPreferencesPanel, {
      settings: {
        turnCompletion: "unfocused",
        permissionEnabled: true,
        questionEnabled: true,
      },
      onSave: async () => undefined,
      localePreference: "system",
      onLocalePreferenceChange: () => undefined,
    }),
    "zh-CN",
  );

  expect(markup).toContain("常规");
  expect(markup).toContain("语言");
  expect(markup).toContain("跟随系统");
  expect(markup).toContain("简体中文");
  expect(markup).toContain("English");
  expect(markup).toContain("通知");
});

test("settings sidebar uses the configurable UI font size", () => {
  const styles = readFileSync(new URL("../src/renderer/styles.css", import.meta.url), "utf8");

  expect(styles).toMatch(
    /\.settings-nav-back,\s*\.settings-nav-item\s*\{[^}]*font-size: var\(--ui-font-size\);/s,
  );
  expect(styles).toMatch(
    /\.settings-nav-search-input\s*\{[^}]*font-size: var\(--ui-font-size\);/s,
  );
  expect(styles).toMatch(
    /\.settings-nav-group-label\s*\{[^}]*font-size: max\(10px, calc\(var\(--ui-font-size\) - 3px\)\);/s,
  );
});

test("settings open fully hides the primary sidebar", () => {
  const styles = readFileSync(new URL("../src/renderer/styles.css", import.meta.url), "utf8");

  expect(styles).toMatch(
    /\.shell\.shell-settings-open\s*>\s*\.codex-sidebar\s*\{[^}]*opacity:\s*0;[^}]*visibility:\s*hidden;[^}]*pointer-events:\s*none;/s,
  );
  expect(styles).toMatch(
    /html\[data-platform="darwin"\]\s*\.settings-nav,\s*html\[data-platform="darwin"\]\[data-window-focused="true"\]\s*\.settings-nav\s*\{[^}]*background:\s*transparent;/s,
  );
});
