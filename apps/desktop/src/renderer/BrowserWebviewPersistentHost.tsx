import { useCallback, useEffect, useSyncExternalStore, type CSSProperties } from "react";
import {
  BROWSER_WEBVIEW_OFFSCREEN_HEIGHT,
  BROWSER_WEBVIEW_OFFSCREEN_WIDTH,
  registerBrowserWebviewHostSlot,
  resolveBrowserWebviewViewportRect,
  subscribeBrowserWebviewViewportRect,
} from "./browser-webview-layout";
import { browserWebviewPool } from "./browser-webview-pool";

export interface BrowserWebviewPersistentHostProps {
  browserId: string;
}

/**
 * Fixed-position DOM slot for one browser guest.
 * Lives in {@link BrowserWebviewLayer} (never unmounts with the task panel).
 * The pool attaches the `<webview>` here; visibility follows viewport rects only.
 */
export function BrowserWebviewPersistentHost({ browserId }: BrowserWebviewPersistentHostProps) {
  const subscribeRect = useCallback(
    (listener: () => void) => subscribeBrowserWebviewViewportRect(browserId, listener),
    [browserId],
  );
  const getRect = useCallback(() => resolveBrowserWebviewViewportRect(browserId), [browserId]);
  const rect = useSyncExternalStore(subscribeRect, getRect, getRect);

  const hostRef = useCallback(
    (node: HTMLDivElement | null) => {
      registerBrowserWebviewHostSlot(browserId, node);
      if (node) {
        browserWebviewPool.attach(browserId);
      }
    },
    [browserId],
  );

  useEffect(() => {
    return () => {
      registerBrowserWebviewHostSlot(browserId, null);
    };
  }, [browserId]);

  const hidden = !rect || rect.width < 8 || rect.height < 8;
  const style: CSSProperties = hidden
    ? {
        position: "fixed",
        left: -10000,
        top: 0,
        width: BROWSER_WEBVIEW_OFFSCREEN_WIDTH,
        height: BROWSER_WEBVIEW_OFFSCREEN_HEIGHT,
        visibility: "hidden",
        pointerEvents: "none",
        overflow: "hidden",
      }
    : {
        position: "fixed",
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        zIndex: 4,
        overflow: "hidden",
        pointerEvents: "auto",
      };

  return (
    <div
      ref={hostRef}
      className="browser-webview-host-slot"
      data-browser-host
      data-browser-id={browserId}
      data-browser-host-hidden={hidden ? "true" : "false"}
      style={style}
    />
  );
}
