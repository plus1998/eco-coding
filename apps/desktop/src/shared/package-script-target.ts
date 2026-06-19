import type { PackageScriptRunTarget } from "./ipc";

export type ExternalPackageScriptRunTarget = Extract<PackageScriptRunTarget, "terminal" | "iterm">;

export function isExternalPackageScriptTarget(
  target: PackageScriptRunTarget,
): target is ExternalPackageScriptRunTarget {
  return target === "terminal" || target === "iterm";
}

export function normalizePackageScriptRunTarget(
  target: PackageScriptRunTarget,
  platform: string,
): PackageScriptRunTarget {
  if (target === "embedded") {
    return "embedded";
  }
  if (platform === "darwin") {
    return target === "iterm" ? "iterm" : "terminal";
  }
  return "terminal";
}

export function listPackageScriptRunTargets(
  platform: string,
): Array<{ value: PackageScriptRunTarget; label: string }> {
  const embedded = { value: "embedded" as const, label: "应用内" };
  if (platform === "darwin") {
    return [
      embedded,
      { value: "terminal", label: "Terminal" },
      { value: "iterm", label: "iTerm" },
    ];
  }
  if (platform === "win32") {
    return [embedded, { value: "terminal", label: "Windows Terminal" }];
  }
  return [embedded, { value: "terminal", label: "外部终端" }];
}

export function externalPackageScriptTargetLabel(
  target: PackageScriptRunTarget,
  platform: string,
  launcherName?: string,
): string {
  if (launcherName) {
    return launcherName;
  }
  if (target === "iterm") {
    return "iTerm2";
  }
  if (platform === "win32") {
    return "Windows Terminal";
  }
  if (platform === "linux") {
    return "外部终端";
  }
  return "Terminal";
}
