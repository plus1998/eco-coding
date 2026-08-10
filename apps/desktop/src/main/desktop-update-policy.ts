import type { DesktopUpdateChannel } from "../shared/desktop-update";

export interface DesktopAutoUpdaterPolicyTarget {
  channel: string | null;
  allowDowngrade: boolean;
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
}

export function applyDesktopAutoUpdaterPolicy(
  updater: DesktopAutoUpdaterPolicyTarget,
  channel: DesktopUpdateChannel,
): void {
  // electron-updater enables allowDowngrade when channel is assigned, so ordering matters here.
  updater.channel = channel;
  updater.allowDowngrade = false;
  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = false;
}
