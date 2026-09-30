import { type CSSProperties, useCallback, useEffect, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { useBrowserStateSelector } from "./browser-state-store";
import {
  BROWSER_WEBVIEW_OFFSCREEN_HEIGHT,
  BROWSER_WEBVIEW_OFFSCREEN_WIDTH,
  BROWSER_WEBVIEW_VISIBLE_Z_INDEX,
  registerBrowserWebviewHostSlot,
  resolveBrowserWebviewViewportRect,
  subscribeBrowserWebviewViewportRect,
} from "./browser-webview-layout";
import { browserWebviewPool } from "./browser-webview-pool";

export interface BrowserWebviewPersistentHostProps {
  browserId: string;
}

function resolveBrowserErrorHost(url?: string): string {
  const value = url?.trim();
  if (!value || value === "about:blank") {
    return "此站点";
  }
  try {
    return new URL(value).hostname || value;
  } catch {
    return value;
  }
}

function BrowserStatusMark() {
  return (
    <svg className="browser-page-status-mark" viewBox="0 0 48 48" aria-hidden>
      <path d="M35 11c-6-7-18-6-24 1-7 8-3 21 7 24 10 3 20-5 18-15-2-9-13-13-20-7-6 5-4 14 3 16 7 2 13-5 10-11-2-5-9-7-13-3-3 3-2 8 2 9 3 1 6-2 5-5" />
    </svg>
  );
}

/**
 * Fixed-position DOM slot for one browser guest.
 * Lives in {@link BrowserWebviewLayer} (never unmounts with the task panel).
 * The pool attaches the `<webview>` here; visibility follows viewport rects only.
 */
export function BrowserWebviewPersistentHost({ browserId }: BrowserWebviewPersistentHostProps) {
  const { t } = useTranslation();
  const subscribeRect = useCallback(
    (listener: () => void) => subscribeBrowserWebviewViewportRect(browserId, listener),
    [browserId],
  );
  const getRect = useCallback(() => resolveBrowserWebviewViewportRect(browserId), [browserId]);
  const rect = useSyncExternalStore(subscribeRect, getRect, getRect);
  const loadError = useBrowserStateSelector(
    (state) => state?.instances.find((instance) => instance.id === browserId)?.loadError,
  );
  const browserUrl = useBrowserStateSelector(
    (state) => state?.instances.find((instance) => instance.id === browserId)?.url,
  );
  const browserIsLoading = useBrowserStateSelector(
    (state) => state?.instances.find((instance) => instance.id === browserId)?.isLoading ?? false,
  );
  const showEmptyState = !loadError && !browserIsLoading && (!browserUrl || browserUrl === "about:blank");
  const errorHost = resolveBrowserErrorHost(loadError?.url ?? browserUrl);
  const showStatus = Boolean(loadError || showEmptyState);

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
        zIndex: BROWSER_WEBVIEW_VISIBLE_Z_INDEX,
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
      data-browser-status={showStatus ? "true" : "false"}
      data-browser-empty={showEmptyState ? "true" : "false"}
      style={style}
    >
      {loadError ? (
        <div className="browser-page-status" role="status">
          <div className="browser-page-status-inner">
            <BrowserStatusMark />
            <h1>{t("browser.loadErrorTitle")}</h1>
            <p className="browser-page-status-subtitle">
              {t("browser.loadErrorSubtitle", { host: errorHost })}
            </p>
            <div className="browser-page-status-try">
              <div>{t("browser.loadErrorTry")}</div>
              <ul>
                <li>{t("browser.loadErrorNetwork")}</li>
                <li>{t("browser.loadErrorProxy")}</li>
              </ul>
            </div>
            <div className="browser-page-status-code">{loadError.description}</div>
            <button
              type="button"
              className="browser-page-status-retry"
              onClick={() => void window.eco?.browserReload?.(browserId)}
            >
              {t("browser.reload")}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
