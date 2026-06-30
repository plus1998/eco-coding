export const PACKAGE_SCRIPT_OVERLAY_TRANSITION_MS = 260;

export function packageScriptOverlayTransitionMs(): number {
  if (typeof window === "undefined") {
    return PACKAGE_SCRIPT_OVERLAY_TRANSITION_MS;
  }
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    return 0;
  }
  return PACKAGE_SCRIPT_OVERLAY_TRANSITION_MS;
}

export function waitMs(ms: number): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

export async function waitForOverlayDismiss(dismissStartedAt: number): Promise<void> {
  const remaining = packageScriptOverlayTransitionMs() - (performance.now() - dismissStartedAt);
  await waitMs(Math.max(0, remaining));
}
