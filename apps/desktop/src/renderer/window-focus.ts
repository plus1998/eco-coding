export function syncWindowFocusState(): void {
  if (typeof document === "undefined") {
    return;
  }
  document.documentElement.dataset.windowFocused = document.hasFocus() ? "true" : "false";
}

export function subscribeToWindowFocus(): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }

  const sync = () => syncWindowFocusState();
  sync();
  window.addEventListener("focus", sync);
  window.addEventListener("blur", sync);
  return () => {
    window.removeEventListener("focus", sync);
    window.removeEventListener("blur", sync);
  };
}
