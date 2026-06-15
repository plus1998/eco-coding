import fixPath from "fix-path";

let applied = false;

/** Restore GUI-process PATH from the user's login shell (macOS/Linux). */
export function ensureDesktopPath(): void {
  if (applied || process.platform === "win32") {
    return;
  }
  fixPath();
  applied = true;
}
