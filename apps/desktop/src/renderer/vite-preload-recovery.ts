const VITE_PRELOAD_RELOAD_KEY = "eco:vite-preload-reload-pending";
const INSTALL_FLAG = "__ecoVitePreloadRecoveryInstalled";

type RecoveryStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function recoverVitePreloadError(
  event: Pick<Event, "preventDefault">,
  storage: RecoveryStorage,
  reload: () => void,
): boolean {
  event.preventDefault();
  try {
    if (storage.getItem(VITE_PRELOAD_RELOAD_KEY)) {
      return false;
    }
    storage.setItem(VITE_PRELOAD_RELOAD_KEY, "1");
  } catch {
    // Storage can be unavailable for hardened renderer sessions; reload still recovers stale chunks.
  }
  reload();
  return true;
}

export function clearVitePreloadRecovery(storage: RecoveryStorage = window.sessionStorage): void {
  try {
    storage.removeItem(VITE_PRELOAD_RELOAD_KEY);
  } catch {
    // The recovery marker is optional when storage is unavailable.
  }
}

export function installVitePreloadRecovery(): void {
  const markedWindow = window as unknown as Window & Record<string, unknown>;
  if (markedWindow[INSTALL_FLAG]) {
    return;
  }
  markedWindow[INSTALL_FLAG] = true;
  window.addEventListener("vite:preloadError", (event) => {
    recoverVitePreloadError(event, window.sessionStorage, () => window.location.reload());
  });
}
