export interface PresentableDesktopWindow {
  isMinimized(): boolean;
  restore(): void;
  show(): void;
  focus(): void;
}

export function presentDesktopWindow(window: PresentableDesktopWindow | undefined): boolean {
  if (!window) {
    return false;
  }
  if (window.isMinimized()) {
    window.restore();
  }
  window.show();
  window.focus();
  return true;
}
