import { i18n } from "./i18n";

export function getRuntimePlatformLabel(): string {
  if (typeof navigator === "undefined") {
    return i18n.t("settings.theme.currentSystem");
  }

  const platform = navigator.platform ?? "";
  const userAgent = navigator.userAgent;

  if (/Mac|iPhone|iPad|iPod/.test(platform) || /Macintosh|Mac OS X/.test(userAgent)) {
    return "macOS";
  }
  if (/Win/.test(platform) || /Windows/.test(userAgent)) {
    return "Windows";
  }
  if (/Linux/.test(platform) || /Linux/.test(userAgent)) {
    return "Linux";
  }

  const trimmed = platform.trim();
  return trimmed.length > 0 ? trimmed : i18n.t("settings.theme.currentSystem");
}
