import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { GeneralSettingsPanel } from "../src/renderer/GeneralSettingsPanel";

test("appearance settings renders theme and typography controls", () => {
  const markup = renderToStaticMarkup(
    createElement(GeneralSettingsPanel, {
      theme: "system",
      onThemeChange: () => undefined,
      typography: { uiFontSize: 14, codeFontSize: 12 },
      onTypographyChange: () => undefined,
    }),
  );

  expect(markup).toContain("外观");
  expect(markup).toContain("主题");
  expect(markup).toContain("UI 字号");
  expect(markup).toContain("代码字体大小");
  expect(markup).toContain("14<small>px</small>");
  expect(markup).toContain("12<small>px</small>");
  expect(markup).toContain('aria-label="减小UI 字号"');
  expect(markup).toContain('aria-label="增大代码字体大小"');
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
