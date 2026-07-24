import { translateCatalog } from "../shared/i18n-catalogs";
import type { AppLocale } from "../shared/locale";

export function formatRelativeTime(
  iso: string,
  now = Date.now(),
  locale: AppLocale = "zh-CN",
): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) {
    return "";
  }

  const diffMs = Math.max(0, now - then);
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) {
    return translateCatalog(locale, "time.justNow");
  }
  if (minutes < 60) {
    return translateCatalog(locale, "time.minutes", { count: minutes });
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return translateCatalog(locale, "time.hours", { count: hours });
  }

  const days = Math.floor(hours / 24);
  if (days < 7) {
    return translateCatalog(locale, "time.days", { count: days });
  }

  const weeks = Math.floor(days / 7);
  if (weeks < 5) {
    return translateCatalog(locale, "time.weeks", { count: weeks });
  }

  const months = Math.floor(days / 30);
  if (months < 12) {
    return translateCatalog(locale, "time.months", { count: months });
  }

  return translateCatalog(locale, "time.years", { count: Math.floor(days / 365) });
}
