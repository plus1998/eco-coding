import i18next from "i18next";
import type { ReactElement } from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nextProvider } from "react-i18next";
import { i18nCatalogs } from "../src/shared/i18n-catalogs";
import type { AppLocale } from "../src/shared/locale";

/**
 * Renders `element` in `locale` with a throwaway i18next instance.
 *
 * The instance is handed to the tree through `I18nextProvider` and is deliberately **not**
 * registered with `initReactI18next`: that plugin also replaces react-i18next's process-wide
 * default instance, so every later file's `useTranslation()` without a provider would render
 * in this locale. That is how a localized test silently broke unrelated files further down
 * the suite (they passed alone and failed only in a full run).
 */
export function renderLocalized(element: ReactElement, locale: AppLocale): string {
  const instance = i18next.createInstance();
  void instance.init({
    resources: i18nCatalogs,
    lng: locale,
    fallbackLng: "en-US",
    initImmediate: false,
    interpolation: { escapeValue: false },
  });
  return renderToStaticMarkup(createElement(I18nextProvider, { i18n: instance }, element));
}
