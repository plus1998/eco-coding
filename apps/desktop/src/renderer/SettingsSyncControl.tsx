import {
  Check,
  Cloud,
  CloudDownload,
  CloudUpload,
  Loader2,
  Minimize2,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import type {
  CenterServerSyncDomain,
  CenterServerSyncDomainResult,
  CenterServerVaultStatus,
} from "../shared/center-server";

type SyncSheetState = {
  mode: "pull" | "push";
  stage: "confirm" | "running" | "done" | "error";
  message: string;
  minimized: boolean;
};

export interface SettingsSyncControlProps {
  domain: CenterServerSyncDomain;
  visible: boolean;
  disabled?: boolean;
  onSync: (domain: CenterServerSyncDomain, mode: "pull" | "push") => Promise<CenterServerSyncDomainResult>;
  onVaultRefresh?: () => void;
}

export function SettingsSyncControl({
  domain,
  visible,
  disabled,
  onSync,
  onVaultRefresh,
}: SettingsSyncControlProps) {
  const { t } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [syncSheet, setSyncSheet] = useState<SyncSheetState | null>(null);
  const syncRunIdRef = useRef(0);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) {
      return;
    }
    function handlePointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    }
    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [menuOpen]);

  useEffect(() => {
    if (!syncSheet || syncSheet.stage !== "done") {
      return;
    }
    const timer = window.setTimeout(
      () => {
        setSyncSheet(null);
      },
      syncSheet.minimized ? 2200 : 1600,
    );
    return () => window.clearTimeout(timer);
  }, [syncSheet]);

  if (!visible) {
    return null;
  }

  function openSync(mode: "pull" | "push") {
    setMenuOpen(false);
    setSyncSheet({
      mode,
      stage: "confirm",
      message:
        mode === "pull"
          ? t("settings.center.vault.confirmPullShort")
          : t("settings.center.vault.confirmPushShort"),
      minimized: false,
    });
  }

  async function runSyncFromSheet() {
    if (!syncSheet || syncSheet.stage === "running") {
      return;
    }
    const mode = syncSheet.mode;
    const runId = ++syncRunIdRef.current;
    setSyncSheet((prev) => ({
      mode,
      stage: "running",
      message:
        mode === "pull"
          ? t("settings.center.vault.syncRunningPull")
          : t("settings.center.vault.syncRunningPush"),
      minimized: prev?.minimized ?? false,
    }));
    try {
      const result = await onSync(domain, mode);
      if (runId !== syncRunIdRef.current) {
        return;
      }
      let message: string;
      if (mode === "pull") {
        if (result.cloudEmpty) {
          message = t("settings.center.vault.pullEmpty");
        } else if (!result.settingsPulled && result.secretsPulled === 0) {
          message = t("settings.center.vault.pullNoChange");
        } else {
          message = t("settings.center.vault.pullDone");
        }
      } else {
        message = t("settings.center.vault.pushDone");
      }
      setSyncSheet((prev) =>
        prev
          ? { ...prev, stage: "done", message }
          : { mode, stage: "done", message, minimized: false },
      );
    } catch (caught) {
      if (runId !== syncRunIdRef.current) {
        return;
      }
      const raw = caught instanceof Error ? caught.message : String(caught);
      let message: string;
      if (/settings_sync_conflict/i.test(raw)) {
        message = t("settings.center.vault.syncConflict");
      } else if (/settings_sync_vault_required/i.test(raw)) {
        message = t("settings.center.vault.vaultRequired");
        onVaultRefresh?.();
      } else if (
        /settings_sync_vault_decrypt/i.test(raw) ||
        /OperationError|Cipher job failed/i.test(raw)
      ) {
        message = `${t("settings.center.vault.vaultDecryptFailed")} ${raw}`;
        onVaultRefresh?.();
      } else {
        message = raw;
      }
      setSyncSheet({
        mode,
        stage: "error",
        message,
        minimized: false,
      });
    }
  }

  return (
    <>
      <div className="settings-sync-control" ref={rootRef}>
        <button
          type="button"
          className="cs-icon-btn settings-sync-trigger"
          disabled={disabled}
          aria-label={t("settings.center.syncStatus.action")}
          title={t("settings.center.syncStatus.action")}
          aria-expanded={menuOpen}
          aria-haspopup="menu"
          onClick={() => setMenuOpen((open) => !open)}
        >
          <Cloud size={16} strokeWidth={1.75} />
        </button>
        {menuOpen ? (
          <div className="settings-sync-menu" role="menu">
            <button type="button" role="menuitem" className="settings-sync-menu-item" onClick={() => openSync("pull")}>
              <CloudDownload size={15} strokeWidth={1.75} />
              {t("settings.center.vault.pull")}
            </button>
            <button type="button" role="menuitem" className="settings-sync-menu-item" onClick={() => openSync("push")}>
              <CloudUpload size={15} strokeWidth={1.75} />
              {t("settings.center.vault.push")}
            </button>
          </div>
        ) : null}
      </div>

      {syncSheet
        ? createPortal(
            syncSheet.minimized ? (
              <button
                type="button"
                className={`cs-sync-pill cs-sync-pill--${syncSheet.stage}`}
                onClick={() => setSyncSheet({ ...syncSheet, minimized: false })}
              >
                {syncSheet.stage === "running" ? (
                  <Loader2 size={14} className="cs-spin" />
                ) : syncSheet.stage === "done" ? (
                  <Check size={14} strokeWidth={2.25} />
                ) : syncSheet.stage === "error" ? (
                  <X size={14} strokeWidth={2.25} />
                ) : syncSheet.mode === "pull" ? (
                  <CloudDownload size={14} strokeWidth={1.75} />
                ) : (
                  <CloudUpload size={14} strokeWidth={1.75} />
                )}
                <span className="cs-sync-pill-text">
                  {syncSheet.stage === "running"
                    ? syncSheet.mode === "pull"
                      ? t("settings.center.vault.syncRunningPull")
                      : t("settings.center.vault.syncRunningPush")
                    : syncSheet.stage === "done"
                      ? t("settings.center.vault.syncDoneShort")
                      : syncSheet.stage === "error"
                        ? t("settings.center.vault.syncFailedShort")
                        : t("settings.center.vault.syncConfirmShort")}
                </span>
              </button>
            ) : (
              <div className="cs-sheet-backdrop cs-sheet-backdrop--blocking" role="presentation">
                <div
                  className="cs-sheet cs-sheet--sync"
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="settings-sync-title"
                >
                  <header className="cs-sheet-head cs-sheet-head--sync">
                    <div className="cs-sheet-head-row">
                      <h2 id="settings-sync-title" className="cs-sheet-title">
                        {syncSheet.stage === "confirm"
                          ? syncSheet.mode === "pull"
                            ? t("settings.center.vault.pull")
                            : t("settings.center.vault.push")
                          : syncSheet.stage === "running"
                            ? syncSheet.mode === "pull"
                              ? t("settings.center.vault.syncRunningPull")
                              : t("settings.center.vault.syncRunningPush")
                            : syncSheet.stage === "done"
                              ? t("settings.center.vault.syncDoneShort")
                              : t("settings.center.vault.syncFailedShort")}
                      </h2>
                      {syncSheet.stage === "running" || syncSheet.stage === "confirm" ? (
                        <button
                          type="button"
                          className="cs-sheet-icon-btn"
                          aria-label={t("settings.center.vault.syncMinimize")}
                          onClick={() => setSyncSheet({ ...syncSheet, minimized: true })}
                        >
                          <Minimize2 size={15} strokeWidth={1.75} />
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="cs-sheet-icon-btn"
                          aria-label={t("common.close")}
                          onClick={() => setSyncSheet(null)}
                        >
                          <X size={15} strokeWidth={1.75} />
                        </button>
                      )}
                    </div>
                  </header>

                  <div className="cs-sync-body">
                    {syncSheet.stage === "running" ? (
                      <div className="cs-sync-progress" aria-hidden>
                        <span />
                      </div>
                    ) : syncSheet.stage === "done" ? (
                      <div className="cs-sync-glyph cs-sync-glyph--done">
                        <Check size={28} strokeWidth={2.25} />
                      </div>
                    ) : syncSheet.stage === "error" ? (
                      <div className="cs-sync-glyph cs-sync-glyph--error">
                        <X size={28} strokeWidth={2.25} />
                      </div>
                    ) : (
                      <div className="cs-sync-glyph">
                        {syncSheet.mode === "pull" ? (
                          <CloudDownload size={28} strokeWidth={1.5} />
                        ) : (
                          <CloudUpload size={28} strokeWidth={1.5} />
                        )}
                      </div>
                    )}
                    <p className="cs-sync-message">{syncSheet.message}</p>
                  </div>

                  <div className="cs-sheet-actions">
                    {syncSheet.stage === "confirm" ? (
                      <>
                        <button
                          type="button"
                          className="cs-btn cs-btn--secondary"
                          onClick={() => setSyncSheet(null)}
                        >
                          {t("common.cancel")}
                        </button>
                        <button type="button" className="cs-btn" onClick={() => void runSyncFromSheet()}>
                          {t("settings.center.vault.syncContinue")}
                        </button>
                      </>
                    ) : syncSheet.stage === "running" ? (
                      <button
                        type="button"
                        className="cs-btn cs-btn--secondary"
                        onClick={() => setSyncSheet({ ...syncSheet, minimized: true })}
                      >
                        {t("settings.center.vault.syncMinimize")}
                      </button>
                    ) : (
                      <button type="button" className="cs-btn" onClick={() => setSyncSheet(null)}>
                        {t("common.done")}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ),
            document.body,
          )
        : null}
    </>
  );
}

export type { CenterServerVaultStatus };
