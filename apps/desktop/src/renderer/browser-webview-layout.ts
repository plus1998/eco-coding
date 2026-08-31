type BrowserWebviewHostSlotListener = () => void;
type BrowserWebviewViewportListener = () => void;

/** Off-screen size while the task panel is closed (guest stays alive). */
export const BROWSER_WEBVIEW_OFFSCREEN_WIDTH = 960;
export const BROWSER_WEBVIEW_OFFSCREEN_HEIGHT = 720;

/**
 * Fixed-position guest layer must sit above the task panel shell (`z-index: 90`
 * in fullscreen / narrow / exit layouts) but below panel chrome overlays (~9000).
 */
export const BROWSER_WEBVIEW_VISIBLE_Z_INDEX = 91;

/** Full-window pointer shield during task-panel resize — above guest webviews. */
export const BROWSER_WEBVIEW_RESIZE_SHIELD_Z_INDEX = BROWSER_WEBVIEW_VISIBLE_Z_INDEX + 1;

const hostSlotsByBrowserId = new Map<string, HTMLElement>();
const viewportRectsByBrowserId = new Map<string, DOMRectReadOnly>();
const hostSlotListenersByBrowserId = new Map<string, Set<BrowserWebviewHostSlotListener>>();
const viewportListenersByBrowserId = new Map<string, Set<BrowserWebviewViewportListener>>();

function notifyHostSlotListeners(browserId: string): void {
  const id = browserId.trim();
  if (!id) {
    return;
  }
  for (const listener of hostSlotListenersByBrowserId.get(id) ?? []) {
    listener();
  }
}

function notifyViewportListeners(browserId: string): void {
  const id = browserId.trim();
  if (!id) {
    return;
  }
  for (const listener of viewportListenersByBrowserId.get(id) ?? []) {
    listener();
  }
}

/** Persistent DOM slot for one browserId (lives in {@link BrowserWebviewLayer}). */
export function registerBrowserWebviewHostSlot(browserId: string, element: HTMLElement | null): void {
  const id = browserId.trim();
  if (!id) {
    return;
  }
  if (element) {
    hostSlotsByBrowserId.set(id, element);
  } else {
    hostSlotsByBrowserId.delete(id);
  }
  notifyHostSlotListeners(id);
}

export function resolveBrowserWebviewHostSlot(browserId: string): HTMLElement | null {
  return hostSlotsByBrowserId.get(browserId.trim()) ?? null;
}

export function subscribeBrowserWebviewHostSlot(
  browserId: string,
  listener: BrowserWebviewHostSlotListener,
): () => void {
  const id = browserId.trim();
  if (!id) {
    return () => {};
  }
  let set = hostSlotListenersByBrowserId.get(id);
  if (!set) {
    set = new Set();
    hostSlotListenersByBrowserId.set(id, set);
  }
  set.add(listener);
  return () => {
    set!.delete(listener);
    if (set!.size === 0) {
      hostSlotListenersByBrowserId.delete(id);
    }
  };
}

/** Viewport rect published by {@link BrowserWebviewViewportMarker} in the task panel. */
export function setBrowserWebviewViewportRect(browserId: string, rect: DOMRectReadOnly | null): void {
  const id = browserId.trim();
  if (!id) {
    return;
  }
  const prev = viewportRectsByBrowserId.get(id);
  if (
    rect &&
    prev &&
    prev.left === rect.left &&
    prev.top === rect.top &&
    prev.width === rect.width &&
    prev.height === rect.height
  ) {
    return;
  }
  if (rect) {
    viewportRectsByBrowserId.set(id, rect);
  } else {
    viewportRectsByBrowserId.delete(id);
  }
  notifyViewportListeners(id);
}

export function resolveBrowserWebviewViewportRect(browserId: string): DOMRectReadOnly | null {
  return viewportRectsByBrowserId.get(browserId.trim()) ?? null;
}

export function subscribeBrowserWebviewViewportRect(
  browserId: string,
  listener: BrowserWebviewViewportListener,
): () => void {
  const id = browserId.trim();
  if (!id) {
    return () => {};
  }
  let set = viewportListenersByBrowserId.get(id);
  if (!set) {
    set = new Set();
    viewportListenersByBrowserId.set(id, set);
  }
  set.add(listener);
  return () => {
    set!.delete(listener);
    if (set!.size === 0) {
      viewportListenersByBrowserId.delete(id);
    }
  };
}

export function resetBrowserWebviewLayoutForTests(): void {
  hostSlotsByBrowserId.clear();
  viewportRectsByBrowserId.clear();
  hostSlotListenersByBrowserId.clear();
  viewportListenersByBrowserId.clear();
}
