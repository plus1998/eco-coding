import {
  ArrowLeft,
  ArrowRight,
  ExternalLink,
  Globe,
  LoaderCircle,
  RefreshCw,
} from "lucide-react";
import {
  useEffect,
  useId,
  useState,
  type FormEvent,
} from "react";
import { useTranslation } from "react-i18next";
import {
  normalizeBrowserNavigateUrl,
  type BrowserViewState,
} from "../shared/browser";
import { BrowserWebviewViewportMarker } from "./BrowserWebviewViewportMarker";

const ICON_SIZE = 15;

export interface BrowserPanelProps {
  /** True when this browser task-panel tab is the active pane. */
  active: boolean;
  /** Eco browser instance id for this task tab. */
  browserId: string;
}

/**
 * Right task-panel browser chrome. Guest WebContents are owned by
 * {@link browserWebviewPool} in {@link BrowserWebviewLayer}; this panel only
 * publishes viewport bounds via {@link BrowserWebviewViewportMarker}.
 */
export function BrowserPanel({ active, browserId }: BrowserPanelProps) {
  const { t } = useTranslation();
  const [state, setState] = useState<BrowserViewState | undefined>();
  const [address, setAddress] = useState("");
  const addressInputId = useId();

  const instance = state?.instances.find((item) => item.id === browserId);
  const displayUrl = instance?.url ?? state?.url ?? "about:blank";
  const canGoBack = instance?.canGoBack ?? state?.canGoBack ?? false;
  const canGoForward = instance?.canGoForward ?? state?.canGoForward ?? false;
  const isLoading = instance?.isLoading ?? state?.isLoading ?? false;

  useEffect(() => {
    void window.eco?.getBrowserState?.().then((next) => {
      setState(next);
      const url = next.instances.find((i) => i.id === browserId)?.url ?? next.url;
      setAddress(url === "about:blank" ? "" : url);
    });
  }, [browserId]);

  useEffect(() => {
    if (!active) {
      return;
    }
    void window.eco?.browserFocus?.({ browserId, reveal: true });
    void window.eco?.browserSetVisible?.({ visible: true, browserId }).then((next) => {
      if (next) {
        setState(next);
        const url = next.instances.find((i) => i.id === browserId)?.url ?? next.url;
        setAddress(url === "about:blank" ? "" : url);
      }
    });
  }, [active, browserId]);

  useEffect(() => {
    const unsubscribe = window.eco?.onBrowserStateChanged?.((next) => {
      setState(next);
      if (!active) {
        return;
      }
      if (!document.activeElement || document.activeElement.id !== addressInputId) {
        const url = next.instances.find((i) => i.id === browserId)?.url ?? next.url;
        setAddress(url === "about:blank" ? "" : url);
      }
    });
    return () => unsubscribe?.();
  }, [active, addressInputId, browserId]);

  async function submitAddress(event: FormEvent) {
    event.preventDefault();
    const url = normalizeBrowserNavigateUrl(address);
    if (!url || !window.eco?.browserNavigate) {
      return;
    }
    const next = await window.eco.browserNavigate({ url, reveal: true, browserId });
    setState(next);
    const shown = next.instances.find((i) => i.id === browserId)?.url ?? next.url;
    setAddress(shown === "about:blank" ? "" : shown);
  }

  return (
    <div className="browser-panel" aria-label={t("browser.title")}>
      <div className="browser-panel-chrome">
        <div className="browser-panel-nav">
          <button
            type="button"
            className="browser-panel-icon-btn"
            disabled={!canGoBack}
            onClick={() => void window.eco?.browserGoBack?.(browserId)}
            aria-label={t("browser.back")}
            title={t("browser.back")}
          >
            <ArrowLeft size={ICON_SIZE} />
          </button>
          <button
            type="button"
            className="browser-panel-icon-btn"
            disabled={!canGoForward}
            onClick={() => void window.eco?.browserGoForward?.(browserId)}
            aria-label={t("browser.forward")}
            title={t("browser.forward")}
          >
            <ArrowRight size={ICON_SIZE} />
          </button>
          <button
            type="button"
            className="browser-panel-icon-btn"
            onClick={() => void window.eco?.browserReload?.(browserId)}
            aria-label={t("browser.reload")}
            title={t("browser.reload")}
          >
            {isLoading ? (
              <LoaderCircle size={ICON_SIZE} className="browser-panel-spin" />
            ) : (
              <RefreshCw size={ICON_SIZE} />
            )}
          </button>
        </div>
        <form className="browser-panel-address-form" onSubmit={(event) => void submitAddress(event)}>
          <label className="sr-only" htmlFor={addressInputId}>
            {t("browser.address")}
          </label>
          <Globe size={14} aria-hidden className="browser-panel-address-icon" />
          <input
            id={addressInputId}
            className="browser-panel-address"
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            placeholder={t("browser.addressPlaceholder")}
            spellCheck={false}
            autoComplete="off"
          />
        </form>
        <button
          type="button"
          className="browser-panel-icon-btn"
          disabled={!displayUrl || displayUrl === "about:blank"}
          onClick={() => void window.eco?.browserOpenExternal?.(browserId)}
          aria-label={t("browser.openExternal")}
          title={t("browser.openExternal")}
        >
          <ExternalLink size={ICON_SIZE} />
        </button>
      </div>
      <BrowserWebviewViewportMarker browserId={browserId} active={active} />
    </div>
  );
}
