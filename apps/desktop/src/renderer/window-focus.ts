export function syncWindowFocusState(): void {
  if (typeof document === "undefined") {
    return;
  }
  document.documentElement.dataset.windowFocused = document.hasFocus() ? "true" : "false";
  if (typeof window !== "undefined" && window.eco?.platform) {
    document.documentElement.dataset.platform = window.eco.platform;
  }
}

export function isThreadActivelyViewed(
  selectedThreadId: string | undefined,
  targetThreadId: string,
  windowFocused: boolean,
): boolean {
  return windowFocused && selectedThreadId === targetThreadId;
}

export function subscribeToWindowFocus(onFocusChange?: (focused: boolean) => void): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }

  const sync = () => {
    syncWindowFocusState();
    onFocusChange?.(document.hasFocus());
  };
  sync();
  window.addEventListener("focus", sync);
  window.addEventListener("blur", sync);
  return () => {
    window.removeEventListener("focus", sync);
    window.removeEventListener("blur", sync);
  };
}
