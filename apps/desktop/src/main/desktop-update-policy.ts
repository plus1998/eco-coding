import type { DesktopUpdateChannel } from "../shared/desktop-update";

export interface DesktopAutoUpdaterPolicyTarget {
  channel: string | null;
  allowDowngrade: boolean;
  allowPrerelease: boolean;
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  disableDifferentialDownload?: boolean;
}

export function applyDesktopAutoUpdaterPolicy(
  updater: DesktopAutoUpdaterPolicyTarget,
  channel: DesktopUpdateChannel,
): void {
  // electron-updater enables allowDowngrade when channel is assigned, so ordering matters here.
  updater.channel = channel;
  updater.allowDowngrade = false;
  // Generic feed uses channel filenames (beta.yml / latest.yml). Do not enable
  // GitHubProvider prerelease heuristics or its latest.yml fallback.
  updater.allowPrerelease = false;
  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = false;
  // GitHub release asset redirects are unreliable for ranged blockmap fetches.
  updater.disableDifferentialDownload = true;
}

/** Compact, UI-safe updater errors (no raw URLs / HttpError dumps). */
export function formatDesktopUpdateError(error: unknown): string {
  const message = (error instanceof Error ? error.message : String(error)).replaceAll(/\s+/g, " ").trim();
  if (!message) {
    return "Unknown update error.";
  }
  if (
    /ERR_UPDATER_CHANNEL_FILE_NOT_FOUND/i.test(message) ||
    /Cannot find \S+\.yml in the latest release artifacts/i.test(message) ||
    /404.*\.(yml|yaml)/i.test(message)
  ) {
    return "CHANNEL_FILE_NOT_FOUND";
  }
  if (/ERR_UPDATER_LATEST_VERSION_NOT_FOUND/i.test(message) || /Unable to find latest version on GitHub/i.test(message)) {
    return "LATEST_VERSION_NOT_FOUND";
  }
  if (/ENOTFOUND|ECONNRESET|ETIMEDOUT|ECONNREFUSED|net::ERR_/i.test(message)) {
    return "NETWORK_ERROR";
  }
  return message
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/\bHttpError:\s*/gi, "")
    .replace(/\bmethod:\s*\w+/gi, "")
    .replace(/\burl:\s*/gi, "")
    .replaceAll(/\s+/g, " ")
    .trim()
    .slice(0, 160);
}
