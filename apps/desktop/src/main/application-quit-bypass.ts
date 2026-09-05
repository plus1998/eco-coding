/** Quit-confirmation bypass flag (e.g. updater install restart). Kept dependency-free for release typecheck. */

let bypassQuitConfirmation = false;

export function setApplicationQuitBypassConfirmation(enabled: boolean): void {
  bypassQuitConfirmation = enabled;
}

export function shouldBypassQuitConfirmation(): boolean {
  return bypassQuitConfirmation;
}
