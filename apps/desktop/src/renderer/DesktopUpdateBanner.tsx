import { Download, ExternalLink, LoaderCircle, RefreshCw, RotateCw, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { DesktopUpdateState } from "../shared/desktop-update";

interface DesktopUpdateBannerProps {
  state: DesktopUpdateState | undefined;
  onCheck: () => void;
  onDownload: () => void;
  onInstall: () => void;
  onOpenRelease: () => void;
  onDismiss: () => void;
}

export function DesktopUpdateBanner({
  state,
  onCheck,
  onDownload,
  onInstall,
  onOpenRelease,
  onDismiss,
}: DesktopUpdateBannerProps) {
  const { t } = useTranslation();

  if (!state || state.phase === "idle" || (state.phase === "disabled" && state.capability === "disabled")) {
    return null;
  }

  const version = state.availableVersion ?? "";
  const progress = state.progress?.percent ?? 0;
  const title = (() => {
    switch (state.phase) {
      case "disabled":
        return state.reason === "unsigned_macos" ? t("update.macosManualTitle") : t("update.manualTitle");
      case "checking":
        return t("update.checking");
      case "available":
        return t("update.available", { version });
      case "downloading":
        return t("update.downloading", { percent: Math.round(progress) });
      case "downloaded":
        return t("update.downloaded", { version });
      case "installing":
        return t("update.installing");
      case "error":
        return t("update.error");
    }
  })();

  return (
    <section className={`desktop-update-banner desktop-update-banner--${state.phase}`} aria-live="polite">
      <div className="desktop-update-banner-content">
        <div className="desktop-update-banner-copy">
          <strong>{title}</strong>
          {state.phase === "disabled" && state.reason === "unsigned_macos" ? (
            <span>{t("update.macosManualHint")}</span>
          ) : null}
          {state.phase === "error" && state.error ? <span>{state.error}</span> : null}
          {state.phase === "downloading" ? (
            <div
              className="desktop-update-progress"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(progress)}
              aria-label={t("update.progress", { percent: Math.round(progress) })}
            >
              <span style={{ width: `${progress}%` }} />
            </div>
          ) : null}
        </div>
        <div className="desktop-update-banner-actions">
          {state.phase === "disabled" ? (
            <button type="button" className="desktop-update-button" onClick={onOpenRelease}>
              <ExternalLink size={14} aria-hidden />
              {t("update.openRelease")}
            </button>
          ) : null}
          {state.phase === "checking" ? (
            <LoaderCircle className="desktop-update-spinner" size={16} aria-hidden />
          ) : null}
          {state.phase === "available" ? (
            <button type="button" className="desktop-update-button" onClick={onDownload}>
              <Download size={14} aria-hidden />
              {t("update.download")}
            </button>
          ) : null}
          {state.phase === "downloaded" ? (
            <button
              type="button"
              className="desktop-update-button desktop-update-button--primary"
              onClick={onInstall}
            >
              <RotateCw size={14} aria-hidden />
              {t("update.restart")}
            </button>
          ) : null}
          {state.phase === "error" ? (
            <>
              <button type="button" className="desktop-update-button" onClick={onCheck}>
                <RefreshCw size={14} aria-hidden />
                {t("common.retry")}
              </button>
              <button type="button" className="desktop-update-button" onClick={onOpenRelease}>
                <ExternalLink size={14} aria-hidden />
                {t("update.openRelease")}
              </button>
            </>
          ) : null}
          {state.phase !== "installing" ? (
            <button
              type="button"
              className="desktop-update-dismiss"
              onClick={onDismiss}
              title={t("common.dismiss")}
              aria-label={t("common.dismiss")}
            >
              <X size={15} aria-hidden />
            </button>
          ) : null}
        </div>
      </div>
    </section>
  );
}
