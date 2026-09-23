import { expect, test } from "bun:test";
import { createElement } from "react";
import { getI18n } from "react-i18next";
import { i18n } from "../src/renderer/i18n";
import { renderLocalized } from "./i18n-test";
import { withTestLanguage } from "./support/test-language";

/**
 * The renderer's i18n instance is the process-wide default react-i18next instance.
 *
 * A `useTranslation()` without a provider resolves that default, so a test helper that
 * registers its own instance through `initReactI18next` changes how every later file in the
 * same `bun test` process renders. That failure mode is invisible in isolation — the victim
 * file passes on its own and only breaks in a full run — so it is asserted here instead of
 * being left to the suite's file order.
 */
withTestLanguage("zh-CN");

test("the renderer's i18n instance is react-i18next's default", () => {
  expect(getI18n()).toBe(i18n);
  expect(i18n.language).toBe("zh-CN");
});

test("rendering a localized element leaves the default instance alone", () => {
  const element = createElement("span", null, "probe");
  expect(renderLocalized(element, "en-US")).toContain("probe");
  expect(renderLocalized(element, "zh-CN")).toContain("probe");
  expect(getI18n()).toBe(i18n);
  expect(i18n.language).toBe("zh-CN");
});
