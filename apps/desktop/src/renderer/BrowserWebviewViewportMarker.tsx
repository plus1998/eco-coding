import { useLayoutEffect, useRef } from "react";
import { setBrowserWebviewViewportRect } from "./browser-webview-layout";

export interface BrowserWebviewViewportMarkerProps {
  browserId: string;
  /** When false the viewport is off-screen (tab hidden or panel exiting). */
  active: boolean;
}

/** Publishes task-panel viewport bounds for the persistent webview host overlay. */
export function BrowserWebviewViewportMarker({ browserId, active }: BrowserWebviewViewportMarkerProps) {
  const markerRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const node = markerRef.current;
    if (!active || !node) {
      setBrowserWebviewViewportRect(browserId, null);
      return;
    }

    const publish = () => {
      const target = markerRef.current;
      if (!target) {
        setBrowserWebviewViewportRect(browserId, null);
        return;
      }
      const rect = target.getBoundingClientRect();
      if (rect.width < 8 || rect.height < 8) {
        setBrowserWebviewViewportRect(browserId, null);
        return;
      }
      setBrowserWebviewViewportRect(browserId, rect);
    };

    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(node);
    window.addEventListener("resize", publish);
    window.addEventListener("scroll", publish, true);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", publish);
      window.removeEventListener("scroll", publish, true);
      setBrowserWebviewViewportRect(browserId, null);
    };
  }, [active, browserId]);

  return (
    <div
      ref={markerRef}
      className="browser-panel-viewport-marker"
      data-browser-viewport
      data-browser-id={browserId}
      aria-hidden
    />
  );
}
