export type DesktopUpdateChannel = "beta" | "latest";

export type DesktopUpdatePlatform = "darwin" | "win32" | "linux";

export type DesktopUpdateMode = "auto" | "manual" | "disabled";

export type DesktopUpdatePhase =
  | "disabled"
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "downloaded"
  | "installing"
  | "error";

export type DesktopUpdateDisabledReason =
  | "development"
  | "release_manifest_missing"
  | "platform_disabled"
  | "unsigned_macos"
  | "not_appimage"
  | "unsupported_platform";

export interface DesktopUpdateProgress {
  percent: number;
  transferred: number;
  total: number;
  bytesPerSecond: number;
}

export interface DesktopUpdateState {
  phase: DesktopUpdatePhase;
  capability: DesktopUpdateMode;
  currentVersion: string;
  channel?: DesktopUpdateChannel;
  availableVersion?: string;
  progress?: DesktopUpdateProgress;
  reason?: DesktopUpdateDisabledReason | "up-to-date" | "download-failed";
  error?: string;
  releaseUrl?: string;
}

export interface DesktopReleaseManifest {
  version: string;
  channel: DesktopUpdateChannel;
  unsigned: boolean;
  releaseUrl: string;
  updateModes: Record<DesktopUpdatePlatform, DesktopUpdateMode>;
}
