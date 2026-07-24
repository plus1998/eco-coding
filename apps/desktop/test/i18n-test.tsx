import i18next from "i18next";
import type { ReactElement } from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { i18nCatalogs } from "../src/shared/i18n-catalogs";
import type { AppLocale } from "../src/shared/locale";

export function renderLocalized(element: ReactElement, locale: AppLocale): string {
  const instance = i18next.createInstance();
  void instance.use(initReactI18next).init({
    resources: i18nCatalogs,
    lng: locale,
    fallbackLng: "en-US",
    initImmediate: false,
    interpolation: { escapeValue: false },
  });
  return renderToStaticMarkup(
    createElement(I18nextProvider, { i18n: instance }, element),
  );
}
