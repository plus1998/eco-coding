import type { PackageScriptRunTarget } from "../shared/ipc";
import { normalizePackageScriptRunTarget } from "../shared/package-script-target";

const STORAGE_KEY = "eco.package-script-run-target";

const VALID_TARGETS = new Set<PackageScriptRunTarget>(["embedded", "terminal", "iterm"]);

function readStoredTarget(): PackageScriptRunTarget {
  if (typeof window === "undefined") {
    return "embedded";
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw || !VALID_TARGETS.has(raw as PackageScriptRunTarget)) {
      return "embedded";
    }
    return raw as PackageScriptRunTarget;
  } catch {
    return "embedded";
  }
}

export function readPackageScriptRunTarget(platform = window.eco?.platform ?? "darwin"): PackageScriptRunTarget {
  return normalizePackageScriptRunTarget(readStoredTarget(), platform);
}

export function savePackageScriptRunTarget(target: PackageScriptRunTarget): void {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(STORAGE_KEY, target);
}
