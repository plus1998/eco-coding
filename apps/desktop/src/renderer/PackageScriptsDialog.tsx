import {
  Copy,
  Loader2,
  Play,
  RefreshCw,
  TextCursorInput,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import type { PackageManagerKind, PackageScriptInfo } from "../shared/ipc";
import { formatRunCommand } from "../shared/package-script-run";
import {
  readWorkspaceScriptArgs,
  saveScriptArgs,
} from "./package-script-args-storage";
import { PACKAGE_SCRIPT_OVERLAY_TRANSITION_MS } from "./package-script-ui";

interface PackageScriptsDialogProps {
  open: boolean;
  workspacePath: string;
  packageName?: string;
  packageManager: PackageManagerKind;
  scripts: PackageScriptInfo[];
  busy?: boolean;
  onClose: () => void;
  onRun: (scriptName: string, args?: string) => void | Promise<void>;
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
  onClose,
  onRun,
  onRefresh,
}: PackageScriptsDialogProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [scriptArgsByName, setScriptArgsByName] = useState<Record<string, string>>({});
  const [editingScript, setEditingScript] = useState<string | null>(null);
  const [draftArgs, setDraftArgs] = useState("");
  const [copiedScript, setCopiedScript] = useState<string | null>(null);
  const [present, setPresent] = useState(open);
  const [entered, setEntered] = useState(false);
  const argsInputRef = useRef<HTMLInputElement>(null);
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
      setCopiedScript(null);
      return;
    }
    let cancelled = false;
    void readWorkspaceScriptArgs(workspacePath).then((args) => {
      if (!cancelled) {
        setScriptArgsByName(args);
      }
    });
    const focusTimer = window.setTimeout(() => searchRef.current?.focus(), 40);
    return () => {
      cancelled = true;
      window.clearTimeout(focusTimer);
    };
  }, [open, workspacePath]);

  useEffect(() => {
    if (!editingScript) {
      return;
    }
    argsInputRef.current?.focus();
    argsInputRef.current?.select();
  }, [editingScript]);

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
        return;
      }
      onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [editingScript, onClose, open]);

  const commitScriptArgs = useCallback(
    async (scriptName: string, nextArgs: string) => {
      const saved = await saveScriptArgs(workspacePath, scriptName, nextArgs);
      setScriptArgsByName(saved);
      setEditingScript(null);
      setDraftArgs("");
    },
    [workspacePath],
  );

  const openArgsEditor = useCallback(
    (scriptName: string) => {
      setEditingScript(scriptName);
      setDraftArgs(scriptArgsByName[scriptName] ?? "");
    },
    [scriptArgsByName],
  );

  const copyScriptCommand = useCallback(
    async (scriptName: string, args?: string) => {
      const command = formatRunCommand(packageManager, scriptName, args);
      try {
        await navigator.clipboard.writeText(command);
        setCopiedScript(scriptName);
      } catch {
        return;
      }
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
        entry.name.toLowerCase().includes(normalized) ||
        entry.command.toLowerCase().includes(normalized),
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
              <p className="package-scripts-subtitle">
                {subtitleParts.join(" · ")}
              </p>
            </div>
            <div className="package-scripts-header-actions">
              <button
                type="button"
                className="package-scripts-icon-btn"
                aria-label={t("dialog.scripts.refreshAria")}
                disabled={busy}
                onClick={() => void onRefresh()}
              >
                <RefreshCw size={15} className={busy ? "spinning" : undefined} />
              </button>
              <button type="button" className="package-scripts-icon-btn" aria-label={t("common.close")} onClick={onClose}>
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
                  const savedArgs = scriptArgsByName[entry.name] ?? "";
                  const isEditingArgs = editingScript === entry.name;
                  const runCommand = formatRunCommand(
                    packageManager,
                    entry.name,
                    savedArgs || undefined,
                  );
                  const isCopied = copiedScript === entry.name;
                  return (
                    <li
                      key={entry.name}
                      className={[
                        "package-scripts-item",
                        isEditingArgs ? "is-editing" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                    >
                      <div className="package-scripts-item-row">
                        <div className="package-scripts-item-main">
                          <span className="package-scripts-item-name">{entry.name}</span>
                          <span
                            className="package-scripts-item-command"
                            title={savedArgs ? runCommand : entry.command}
                          >
                            {savedArgs ? runCommand : entry.command}
                          </span>
                        </div>
                        <div className="package-scripts-item-actions">
                          <button
                            type="button"
                            className={[
                              "package-scripts-action-btn",
                              savedArgs ? "is-active" : "",
                              isEditingArgs ? "is-editing" : "",
                            ]
                              .filter(Boolean)
                              .join(" ")}
                            aria-label={t("dialog.scripts.argsFor", { name: entry.name })}
                            title={
                              savedArgs
                                ? t("dialog.scripts.argsValue", { args: savedArgs })
                                : t("dialog.scripts.args")
                            }
                            disabled={busy}
                            onClick={() => {
                              if (isEditingArgs) {
                                void commitScriptArgs(entry.name, draftArgs);
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
                            title={isCopied ? t("dialog.scripts.copied") : t("dialog.scripts.copy", { name: runCommand })}
                            disabled={busy}
                            onClick={() => void copyScriptCommand(entry.name, savedArgs || undefined)}
                          >
                            <Copy size={14} aria-hidden />
                          </button>
                          <button
                            type="button"
                            className="package-scripts-run-btn"
                            aria-label={t("dialog.scripts.runFor", { name: entry.name })}
                            title={t("dialog.scripts.run")}
                            disabled={busy}
                            onClick={() => void onRun(entry.name, savedArgs || undefined)}
                          >
                            {busy ? (
                              <Loader2 size={14} className="spinning" aria-hidden />
                            ) : (
                              <Play size={14} aria-hidden />
                            )}
                          </button>
                        </div>
                      </div>
                      {isEditingArgs ? (
                        <div className="package-scripts-args-row">
                          <input
                            ref={argsInputRef}
                            type="text"
                            className="package-scripts-args-input"
                            value={draftArgs}
                            placeholder={t("dialog.scripts.args")}
                            aria-label={t("dialog.scripts.argsFor", { name: entry.name })}
                            disabled={busy}
                            onChange={(event) => setDraftArgs(event.target.value)}
                            onBlur={() => void commitScriptArgs(entry.name, draftArgs)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") {
                                event.preventDefault();
                                void commitScriptArgs(entry.name, draftArgs);
                              }
                              if (event.key === "Escape") {
                                event.preventDefault();
                                event.stopPropagation();
                                setEditingScript(null);
                                setDraftArgs("");
                              }
                            }}
                          />
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
