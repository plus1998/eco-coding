export function getRuntimePlatformLabel(): string {
  if (typeof navigator === "undefined") {
    return "当前系统";
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
  return trimmed.length > 0 ? trimmed : "当前系统";
}
