import {
  ArrowLeft,
  ArrowRight,
  ExternalLink,
  Globe,
  LoaderCircle,
  RefreshCw,
} from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { normalizeBrowserNavigateUrl, type BrowserViewState } from "../shared/browser";

const ICON_SIZE = 15;

export interface BrowserPanelProps {
  /** True when the browser task-panel tab is the active pane (syncs WebContentsView bounds). */
  active: boolean;
}

/**
 * Right task-panel browser content: chrome + host rect for main-process WebContentsView.
 * Visibility of the native view is tied to `active` (panel tab selection).
 */
export function BrowserPanel({ active }: BrowserPanelProps) {
  const { t } = useTranslation();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [state, setState] = useState<BrowserViewState | undefined>();
  const [address, setAddress] = useState("");
  const addressInputId = useId();

  const syncBounds = useCallback(() => {
    if (!active || !hostRef.current || !window.eco?.browserSetBounds) {
      return;
    }
    const rect = hostRef.current.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) {
      return;
    }
    void window.eco.browserSetBounds({
      bounds: {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      },
    });
  }, [active]);

  useEffect(() => {
    if (!active) {
      void window.eco?.browserSetVisible?.({ visible: false });
      return;
    }
    void window.eco?.browserSetVisible?.({ visible: true }).then((next) => {
      if (next) {
        setState(next);
        setAddress(next.url === "about:blank" ? "" : next.url);
      }
      requestAnimationFrame(() => syncBounds());
    });
    return () => {
      void window.eco?.browserSetVisible?.({ visible: false });
    };
  }, [active, syncBounds]);

  useEffect(() => {
    if (!active) return;
    const unsubscribe = window.eco?.onBrowserStateChanged?.((next) => {
      setState(next);
      if (!document.activeElement || document.activeElement.id !== addressInputId) {
        setAddress(next.url === "about:blank" ? "" : next.url);
      }
    });
    return () => unsubscribe?.();
  }, [active, addressInputId]);

  useEffect(() => {
    if (!active || !hostRef.current) return;
    const node = hostRef.current;
    const observer = new ResizeObserver(() => {
      syncBounds();
    });
    observer.observe(node);
    window.addEventListener("resize", syncBounds);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", syncBounds);
    };
  }, [active, syncBounds]);

  async function submitAddress(event: FormEvent) {
    event.preventDefault();
    const url = normalizeBrowserNavigateUrl(address);
    if (!url || !window.eco?.browserNavigate) {
      return;
    }
    const next = await window.eco.browserNavigate({ url, reveal: true });
    setState(next);
    setAddress(next.url === "about:blank" ? "" : next.url);
    requestAnimationFrame(() => syncBounds());
  }

  return (
    <div className="browser-panel" aria-label={t("browser.title")}>
      <div className="browser-panel-chrome">
        <div className="browser-panel-nav">
          <button
            type="button"
            className="browser-panel-icon-btn"
            disabled={!state?.canGoBack}
            onClick={() => void window.eco?.browserGoBack?.()}
            aria-label={t("browser.back")}
            title={t("browser.back")}
          >
            <ArrowLeft size={ICON_SIZE} />
          </button>
          <button
            type="button"
            className="browser-panel-icon-btn"
            disabled={!state?.canGoForward}
            onClick={() => void window.eco?.browserGoForward?.()}
            aria-label={t("browser.forward")}
            title={t("browser.forward")}
          >
            <ArrowRight size={ICON_SIZE} />
          </button>
          <button
            type="button"
            className="browser-panel-icon-btn"
            onClick={() => void window.eco?.browserReload?.()}
            aria-label={t("browser.reload")}
            title={t("browser.reload")}
          >
            {state?.isLoading ? (
              <LoaderCircle size={ICON_SIZE} className="spinning" />
            ) : (
              <RefreshCw size={ICON_SIZE} />
            )}
          </button>
          <form className="browser-panel-address-form" onSubmit={(event) => void submitAddress(event)}>
            <label className="sr-only" htmlFor={addressInputId}>
              {t("browser.address")}
            </label>
            <input
              id={addressInputId}
              className="browser-panel-address"
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              placeholder={t("browser.addressPlaceholder")}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
            />
          </form>
          <button
            type="button"
            className="browser-panel-icon-btn"
            onClick={() => void window.eco?.browserOpenExternal?.()}
            aria-label={t("browser.openExternal")}
            title={t("browser.openExternal")}
          >
            <ExternalLink size={ICON_SIZE} />
          </button>
        </div>
        {state?.title ? (
          <div className="browser-panel-title-row" title={state.title}>
            <Globe size={12} aria-hidden />
            <span>{state.title}</span>
          </div>
        ) : null}
      </div>
      <div ref={hostRef} className="browser-panel-host" data-browser-host />
    </div>
  );
}
