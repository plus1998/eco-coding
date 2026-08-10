import type { DesktopUpdateState } from "../shared/desktop-update";

export function shouldRevealDesktopUpdateBanner(
  previous: DesktopUpdateState | undefined,
  next: DesktopUpdateState,
): boolean {
  if (!isDesktopUpdateBannerVisible(next)) {
    return false;
  }
  if (!previous || !isDesktopUpdateBannerVisible(previous)) {
    return true;
  }
  if (next.availableVersion && next.availableVersion !== previous.availableVersion) {
    return true;
  }
  return previous.phase !== next.phase && (next.phase === "downloaded" || next.phase === "error");
}

function isDesktopUpdateBannerVisible(state: DesktopUpdateState): boolean {
  return state.phase !== "idle" && !(state.phase === "disabled" && state.capability === "disabled");
}
