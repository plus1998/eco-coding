import type { ActionKindTranslate } from "../src/shared/feed-action-kind";
import { i18nCatalogs } from "../src/shared/i18n-catalogs";

function catalogTranslate(locale: "zh-CN" | "en-US"): ActionKindTranslate {
  return (key, vars) => {
    const catalog = i18nCatalogs[locale].translation as Record<string, string>;
    let template = catalog[key];
    if (!template) {
      throw new Error(`missing i18n key ${key}`);
    }
    for (const [name, value] of Object.entries(vars ?? {})) {
      template = template.replaceAll(`{{${name}}}`, String(value));
    }
    return template;
  };
}

export const tZh: ActionKindTranslate = catalogTranslate("zh-CN");
export const tEn: ActionKindTranslate = catalogTranslate("en-US");
