import { Copy, Loader2, Play, RefreshCw, TextCursorInput, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import type { CenterServerSyncDomain, CenterServerSyncDomainResult } from "../shared/center-server";
import type { PackageManagerKind, PackageScriptInfo, PackageScriptOverrides } from "../shared/ipc";
import { formatRunCommand } from "../shared/package-script-run";
import { copyTextToClipboard } from "./clipboard";
import { readWorkspaceScriptOverrides, saveScriptOverrides } from "./package-script-args-storage";
import { PACKAGE_SCRIPT_OVERLAY_TRANSITION_MS } from "./package-script-ui";
import { SettingsSyncControl } from "./SettingsSyncControl";

interface PackageScriptsDialogProps {
  open: boolean;
  workspacePath: string;
  packageName?: string;
  packageManager: PackageManagerKind;
  scripts: PackageScriptInfo[];
  busy?: boolean;
  argsRevision?: number;
  centerServerSyncVisible?: boolean;
  onSyncDomain?: (
    domain: CenterServerSyncDomain,
    mode: "pull" | "push",
  ) => Promise<CenterServerSyncDomainResult>;
  onClose: () => void;
  onRun: (scriptName: string, args?: string, prefix?: string) => void | Promise<void>;
  onRefresh: () => void | Promise<void>;
}

const PACKAGE_MANAGER_LABELS: Record<PackageManagerKind, string> = {
  bun: "Bun",
  pnpm: "pnpm",
  yarn: "Yarn",
  npm: "npm",
};

export function PackageScriptsDialog({
  open,
  workspacePath,
  packageName,
  packageManager,
  scripts,
  busy,
  argsRevision = 0,
  centerServerSyncVisible,
  onSyncDomain,
  onClose,
  onRun,
  onRefresh,
}: PackageScriptsDialogProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [overrides, setOverrides] = useState<PackageScriptOverrides>({ args: {}, prefixes: {} });
  const [editingScript, setEditingScript] = useState<string | null>(null);
  const [draftArgs, setDraftArgs] = useState("");
  const [draftPrefix, setDraftPrefix] = useState("");
  const [copiedScript, setCopiedScript] = useState<string | null>(null);
  const [present, setPresent] = useState(open);
  const [entered, setEntered] = useState(false);
  const argsInputRef = useRef<HTMLInputElement>(null);
  const prefixInputRef = useRef<HTMLInputElement>(null);
  const focusedEditorRef = useRef<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setPresent(true);
      const frame = window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => setEntered(true));
      });
      return () => window.cancelAnimationFrame(frame);
    }
    setEntered(false);
    const timer = window.setTimeout(() => setPresent(false), PACKAGE_SCRIPT_OVERLAY_TRANSITION_MS);
    return () => window.clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setEditingScript(null);
      setDraftArgs("");
      setDraftPrefix("");
      setCopiedScript(null);
      return;
    }
    let cancelled = false;
    void readWorkspaceScriptOverrides(workspacePath).then((next) => {
      if (!cancelled) {
        setOverrides(next);
      }
    });
    const focusTimer = window.setTimeout(() => searchRef.current?.focus(), 40);
    return () => {
      cancelled = true;
      window.clearTimeout(focusTimer);
    };
  }, [open, workspacePath, argsRevision]);

  useEffect(() => {
    if (!editingScript) {
      focusedEditorRef.current = null;
      return;
    }
    if (focusedEditorRef.current === editingScript) {
      return;
    }
    focusedEditorRef.current = editingScript;
    const target = draftPrefix ? prefixInputRef.current : argsInputRef.current;
    target?.focus();
    target?.select();
  }, [draftPrefix, editingScript]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }
      event.preventDefault();
      if (editingScript) {
        setEditingScript(null);
        setDraftArgs("");
        setDraftPrefix("");
        return;
      }
      onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [editingScript, onClose, open]);

  const commitScriptOverrides = useCallback(
    async (scriptName: string, nextArgs: string, nextPrefix: string) => {
      const saved = await saveScriptOverrides(workspacePath, scriptName, {
        args: nextArgs,
        prefix: nextPrefix,
      });
      setOverrides(saved);
      setEditingScript(null);
      setDraftArgs("");
      setDraftPrefix("");
    },
    [workspacePath],
  );

  const openArgsEditor = useCallback(
    (scriptName: string) => {
      setEditingScript(scriptName);
      setDraftArgs(overrides.args[scriptName] ?? "");
      setDraftPrefix(overrides.prefixes[scriptName] ?? "");
    },
    [overrides],
  );

  const copyScriptCommand = useCallback(
    async (scriptName: string, args?: string, prefix?: string) => {
      const command = formatRunCommand(packageManager, scriptName, args, prefix);
      const ok = await copyTextToClipboard(command);
      if (!ok) {
        return;
      }
      setCopiedScript(scriptName);
    },
    [packageManager],
  );

  useEffect(() => {
    if (!copiedScript) {
      return;
    }
    const timer = window.setTimeout(() => setCopiedScript(null), 1500);
    return () => window.clearTimeout(timer);
  }, [copiedScript]);

  const filteredScripts = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return scripts;
    }
    return scripts.filter(
      (entry) =>
        entry.name.toLowerCase().includes(normalized) || entry.command.toLowerCase().includes(normalized),
    );
  }, [query, scripts]);

  if (!present) {
    return null;
  }

  const managerLabel = PACKAGE_MANAGER_LABELS[packageManager];
  const subtitleParts = [
    packageName,
    managerLabel,
    scripts.length > 0 ? t("dialog.scripts.count", { count: scripts.length }) : null,
  ].filter(Boolean);

  return createPortal(
    <div
      className={["package-scripts-backdrop", entered ? "is-open" : ""].filter(Boolean).join(" ")}
      onMouseDown={onClose}
    >
      <div className="package-scripts-shell" onMouseDown={(event) => event.stopPropagation()}>
        <div
          className="package-scripts-dialog"
          role="dialog"
          aria-label={t("dialog.scripts.title")}
          aria-modal="true"
        >
          <header className="package-scripts-header">
            <div className="package-scripts-header-text">
              <h2 className="package-scripts-title">{t("dialog.scripts.title")}</h2>
              <p className="package-scripts-subtitle">{subtitleParts.join(" · ")}</p>
            </div>
            <div className="package-scripts-header-actions">
              {onSyncDomain ? (
                <SettingsSyncControl
                  domain="packageScriptArgs"
                  visible={centerServerSyncVisible ?? false}
                  disabled={busy}
                  onSync={onSyncDomain}
                />
              ) : null}
              <button
                type="button"
                className="package-scripts-icon-btn"
                aria-label={t("dialog.scripts.refreshAria")}
                disabled={busy}
                onClick={() => void onRefresh()}
              >
                <RefreshCw size={15} className={busy ? "spinning" : undefined} />
              </button>
              <button
                type="button"
                className="package-scripts-icon-btn"
                aria-label={t("common.close")}
                onClick={onClose}
              >
                <X size={15} />
              </button>
            </div>
          </header>

          {scripts.length > 0 ? (
            <div className="package-scripts-toolbar">
              <input
                ref={searchRef}
                type="search"
                className="package-scripts-search"
                value={query}
                placeholder={t("common.search")}
                aria-label={t("dialog.scripts.searchAria")}
                disabled={busy}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
          ) : null}

          <div className="package-scripts-body">
            {scripts.length === 0 ? (
              <p className="package-scripts-empty">{t("dialog.scripts.empty")}</p>
            ) : filteredScripts.length === 0 ? (
              <p className="package-scripts-empty">{t("dialog.scripts.noMatch")}</p>
            ) : (
              <ul className="package-scripts-list">
                {filteredScripts.map((entry) => {
                  const savedArgs = overrides.args[entry.name] ?? "";
                  const savedPrefix = overrides.prefixes[entry.name] ?? "";
                  const hasOverrides = Boolean(savedArgs || savedPrefix);
                  const isEditing = editingScript === entry.name;
                  const runCommand = formatRunCommand(
                    packageManager,
                    entry.name,
                    savedArgs || undefined,
                    savedPrefix || undefined,
                  );
                  const isCopied = copiedScript === entry.name;
                  const overrideSummary = [
                    savedPrefix ? t("dialog.scripts.prefixValue", { prefix: savedPrefix }) : "",
                    savedArgs ? t("dialog.scripts.argsValue", { args: savedArgs }) : "",
                  ]
                    .filter(Boolean)
                    .join(" · ");
                  return (
                    <li
                      key={entry.name}
                      className={["package-scripts-item", isEditing ? "is-editing" : ""]
                        .filter(Boolean)
                        .join(" ")}
                    >
                      <div className="package-scripts-item-row">
                        <div className="package-scripts-item-main">
                          <span className="package-scripts-item-name">{entry.name}</span>
                          <span
                            className="package-scripts-item-command"
                            title={hasOverrides ? runCommand : entry.command}
                          >
                            {hasOverrides ? runCommand : entry.command}
                          </span>
                        </div>
                        <div className="package-scripts-item-actions">
                          <button
                            type="button"
                            className={[
                              "package-scripts-action-btn",
                              hasOverrides ? "is-active" : "",
                              isEditing ? "is-editing" : "",
                            ]
                              .filter(Boolean)
                              .join(" ")}
                            aria-label={t("dialog.scripts.customizeFor", { name: entry.name })}
                            title={overrideSummary || t("dialog.scripts.customize")}
                            disabled={busy}
                            onClick={() => {
                              if (isEditing) {
                                void commitScriptOverrides(entry.name, draftArgs, draftPrefix);
                                return;
                              }
                              openArgsEditor(entry.name);
                            }}
                          >
                            <TextCursorInput size={14} aria-hidden />
                          </button>
                          <button
                            type="button"
                            className={["package-scripts-action-btn", isCopied ? "is-active" : ""]
                              .filter(Boolean)
                              .join(" ")}
                            aria-label={
                              isCopied
                                ? t("dialog.scripts.copiedCommand", { name: entry.name })
                                : t("dialog.scripts.copy", { name: entry.name })
                            }
                            title={
                              isCopied
                                ? t("dialog.scripts.copied")
                                : t("dialog.scripts.copy", { name: runCommand })
                            }
                            disabled={busy}
                            onClick={() =>
                              void copyScriptCommand(
                                entry.name,
                                savedArgs || undefined,
                                savedPrefix || undefined,
                              )
                            }
                          >
                            <Copy size={14} aria-hidden />
                          </button>
                          <button
                            type="button"
                            className="package-scripts-run-btn"
                            aria-label={t("dialog.scripts.runFor", { name: entry.name })}
                            title={t("dialog.scripts.run")}
                            disabled={busy}
                            onClick={() =>
                              void onRun(entry.name, savedArgs || undefined, savedPrefix || undefined)
                            }
                          >
                            {busy ? (
                              <Loader2 size={14} className="spinning" aria-hidden />
                            ) : (
                              <Play size={14} aria-hidden />
                            )}
                          </button>
                        </div>
                      </div>
                      {isEditing ? (
                        <div className="package-scripts-override-grid">
                          <label className="package-scripts-field">
                            <span className="package-scripts-field-label">{t("dialog.scripts.prefix")}</span>
                            <input
                              ref={prefixInputRef}
                              type="text"
                              className="package-scripts-args-input"
                              value={draftPrefix}
                              placeholder={t("dialog.scripts.prefixPlaceholder")}
                              aria-label={t("dialog.scripts.prefixFor", { name: entry.name })}
                              disabled={busy}
                              onChange={(event) => setDraftPrefix(event.target.value)}
                              onBlur={(event) => {
                                if (
                                  (event.relatedTarget as HTMLElement | null)?.closest(
                                    ".package-scripts-override-grid",
                                  )
                                ) {
                                  return;
                                }
                                void commitScriptOverrides(entry.name, draftArgs, draftPrefix);
                              }}
                              onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                  event.preventDefault();
                                  void commitScriptOverrides(entry.name, draftArgs, draftPrefix);
                                }
                                if (event.key === "Escape") {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  setEditingScript(null);
                                  setDraftArgs("");
                                  setDraftPrefix("");
                                }
                              }}
                            />
                          </label>
                          <label className="package-scripts-field">
                            <span className="package-scripts-field-label">{t("dialog.scripts.args")}</span>
                            <input
                              ref={argsInputRef}
                              type="text"
                              className="package-scripts-args-input"
                              value={draftArgs}
                              placeholder={t("dialog.scripts.argsPlaceholder")}
                              aria-label={t("dialog.scripts.argsFor", { name: entry.name })}
                              disabled={busy}
                              onChange={(event) => setDraftArgs(event.target.value)}
                              onBlur={(event) => {
                                if (
                                  (event.relatedTarget as HTMLElement | null)?.closest(
                                    ".package-scripts-override-grid",
                                  )
                                ) {
                                  return;
                                }
                                void commitScriptOverrides(entry.name, draftArgs, draftPrefix);
                              }}
                              onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                  event.preventDefault();
                                  void commitScriptOverrides(entry.name, draftArgs, draftPrefix);
                                }
                                if (event.key === "Escape") {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  setEditingScript(null);
                                  setDraftArgs("");
                                  setDraftPrefix("");
                                }
                              }}
                            />
                          </label>
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <footer className="package-scripts-footer">
            <span className="package-scripts-path" title={workspacePath}>
              {workspacePath}
            </span>
          </footer>
        </div>
      </div>
    </div>,
    document.body,
  );
}
