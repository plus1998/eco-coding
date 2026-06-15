import { Loader2, Play, RefreshCw, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type {
  PackageManagerKind,
  PackageScriptInfo,
  RunPackageScriptResult,
} from "../shared/ipc";

interface PackageScriptsDialogProps {
  open: boolean;
  workspacePath: string;
  packageName?: string;
  packageManager: PackageManagerKind;
  scripts: PackageScriptInfo[];
  busy?: boolean;
  runningScript?: string;
  lastResult?: RunPackageScriptResult;
  onClose: () => void;
  onRun: (scriptName: string) => void | Promise<void>;
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
  runningScript,
  lastResult,
  onClose,
  onRun,
  onRefresh,
}: PackageScriptsDialogProps) {
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!open) {
      setQuery("");
    }
  }, [open]);

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

  if (!open) {
    return null;
  }

  const outputText = [lastResult?.stdout, lastResult?.stderr].filter(Boolean).join("\n").trim();

  return createPortal(
    <div className="git-commit-dialog-backdrop" onMouseDown={onClose}>
      <div
        className="package-scripts-dialog"
        role="dialog"
        aria-label="npm scripts"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="package-scripts-dialog-header">
          <div>
            <h2 className="package-scripts-dialog-title">npm scripts</h2>
            <p className="package-scripts-dialog-subtitle">
              {packageName ? `${packageName} · ` : ""}
              {PACKAGE_MANAGER_LABELS[packageManager]}
            </p>
          </div>
          <div className="package-scripts-dialog-header-actions">
            <button
              type="button"
              className="settings-icon-button"
              aria-label="刷新脚本列表"
              disabled={busy}
              onClick={() => void onRefresh()}
            >
              <RefreshCw size={16} className={busy ? "spinning" : undefined} />
            </button>
            <button type="button" className="settings-icon-button" aria-label="关闭" onClick={onClose}>
              <X size={16} />
            </button>
          </div>
        </header>

        {scripts.length > 0 ? (
          <input
            type="search"
            className="package-scripts-search"
            value={query}
            placeholder="搜索脚本…"
            aria-label="搜索脚本"
            disabled={busy}
            onChange={(event) => setQuery(event.target.value)}
          />
        ) : null}

        {scripts.length === 0 ? (
          <p className="settings-empty-hint">当前工作区没有可运行的 package.json scripts。</p>
        ) : filteredScripts.length === 0 ? (
          <p className="settings-empty-hint">没有匹配的脚本。</p>
        ) : (
          <ul className="mcp-server-list package-scripts-list">
            {filteredScripts.map((entry) => {
              const isRunning = runningScript === entry.name;
              return (
                <li key={entry.name} className="mcp-server-row package-scripts-row">
                  <div className="package-scripts-row-main">
                    <span className="mcp-server-name">{entry.name}</span>
                    <span className="package-scripts-row-command" title={entry.command}>
                      {entry.command}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="package-scripts-run-button"
                    disabled={busy || Boolean(runningScript)}
                    onClick={() => void onRun(entry.name)}
                  >
                    {isRunning ? (
                      <Loader2 size={14} className="spinning" aria-hidden />
                    ) : (
                      <Play size={14} aria-hidden />
                    )}
                    <span>{isRunning ? "运行中…" : "运行"}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {lastResult ? (
          <section className="package-scripts-output-section" aria-live="polite">
            <div className="package-scripts-output-head">
              <span className="package-scripts-output-label">最近执行</span>
              <span
                className={
                  lastResult.exitCode === 0
                    ? "package-scripts-exit-badge is-success"
                    : "package-scripts-exit-badge is-failure"
                }
              >
                exit {lastResult.exitCode}
              </span>
            </div>
            <pre className="package-scripts-output">{outputText || "（无输出）"}</pre>
            <p className="package-scripts-output-command" title={lastResult.command.join(" ")}>
              {lastResult.command.join(" ")}
            </p>
          </section>
        ) : null}

        <p className="package-scripts-path" title={workspacePath}>
          {workspacePath}
        </p>
      </div>
    </div>,
    document.body,
  );
}
