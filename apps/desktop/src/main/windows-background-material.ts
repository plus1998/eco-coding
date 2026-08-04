const WINDOWS_11_MINIMUM_BUILD = 22000;

export type WindowsBackdropVersion = "win10" | "win11";

export function resolveWindowsBackdropVersion(release: string): WindowsBackdropVersion {
  const build = Number.parseInt(release.split(".")[2] ?? "", 10);
  return Number.isFinite(build) && build >= WINDOWS_11_MINIMUM_BUILD ? "win11" : "win10";
}

export function resolveWindowsBackgroundMaterial(release: string): "mica" | undefined {
  return resolveWindowsBackdropVersion(release) === "win11" ? "mica" : undefined;
}
