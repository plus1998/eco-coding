import { Copy, Loader2, Play, RefreshCw, Square, TextCursorInput, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { PackageManagerKind, PackageScriptInfo } from "../shared/ipc";
import { formatRunCommand } from "../shared/package-script-run";
import { AnsiOutput } from "./AnsiOutput";
import {
  readWorkspaceScriptArgs,
  saveScriptArgs,
} from "./package-script-args-storage";

export interface PackageScriptRunViewState {
  runId?: string;
  script?: string;
  command?: string[];
  output: string;
  exitCode?: number;
  running: boolean;
}

interface PackageScriptsDialogProps {
  open: boolean;
  workspacePath: string;
  packageName?: string;
  packageManager: PackageManagerKind;
  scripts: PackageScriptInfo[];
  busy?: boolean;
  runningScript?: string;
  runState?: PackageScriptRunViewState;
  onClose: () => void;
  onRun: (scriptName: string, args?: string) => void | Promise<void>;
  onStop?: () => void | Promise<void>;
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
  runState,
  onClose,
  onRun,
  onStop,
  onRefresh,
}: PackageScriptsDialogProps) {
  const [query, setQuery] = useState("");
  const [scriptArgsByName, setScriptArgsByName] = useState<Record<string, string>>({});
  const [editingScript, setEditingScript] = useState<string | null>(null);
  const [draftArgs, setDraftArgs] = useState("");
  const [copiedScript, setCopiedScript] = useState<string | null>(null);
  const outputRef = useRef<HTMLPreElement>(null);
  const argsInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setEditingScript(null);
      setDraftArgs("");
      setCopiedScript(null);
      return;
    }
    setScriptArgsByName(readWorkspaceScriptArgs(workspacePath));
  }, [open, workspacePath]);

  useEffect(() => {
    if (!editingScript) {
      return;
    }
    argsInputRef.current?.focus();
    argsInputRef.current?.select();
  }, [editingScript]);

  const commitScriptArgs = useCallback(
    (scriptName: string, nextArgs: string) => {
      const saved = saveScriptArgs(workspacePath, scriptName, nextArgs);
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

  useEffect(() => {
    const node = outputRef.current;
    if (!node) {
      return;
    }
    node.scrollTop = node.scrollHeight;
  }, [runState?.output]);

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

  const showOutput = Boolean(runState && (runState.running || runState.output || runState.exitCode !== undefined));

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
            {runState?.running && onStop ? (
              <button
                type="button"
                className="package-scripts-stop-button"
                aria-label="停止脚本"
                onClick={() => void onStop()}
              >
                <Square size={14} aria-hidden />
                <span>停止</span>
              </button>
            ) : null}
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
              const savedArgs = scriptArgsByName[entry.name] ?? "";
              const isEditingArgs = editingScript === entry.name;
              const runCommand = formatRunCommand(
                packageManager,
                entry.name,
                savedArgs || undefined,
              );
              const isCopied = copiedScript === entry.name;
              return (
                <li key={entry.name} className="mcp-server-row package-scripts-row">
                  <div className="package-scripts-row-main">
                    <span className="mcp-server-name">{entry.name}</span>
                    <span
                      className="package-scripts-row-command"
                      title={savedArgs ? runCommand : entry.command}
                    >
                      {savedArgs ? runCommand : entry.command}
                    </span>
                  </div>
                  <div className="package-scripts-row-actions">
                    {isEditingArgs ? (
                      <input
                        ref={argsInputRef}
                        type="text"
                        className="package-scripts-args-input"
                        value={draftArgs}
                        placeholder="附加参数，如 root@xxx"
                        aria-label={`${entry.name} 附加参数`}
                        disabled={busy || Boolean(runningScript)}
                        onChange={(event) => setDraftArgs(event.target.value)}
                        onBlur={() => commitScriptArgs(entry.name, draftArgs)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            commitScriptArgs(entry.name, draftArgs);
                          }
                          if (event.key === "Escape") {
                            event.preventDefault();
                            setEditingScript(null);
                            setDraftArgs("");
                          }
                        }}
                      />
                    ) : null}
                    <button
                      type="button"
                      className={[
                        "package-scripts-args-button",
                        savedArgs ? "is-active" : "",
                        isEditingArgs ? "is-editing" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      aria-label={`${entry.name} 附加参数`}
                      title={savedArgs ? `附加参数：${savedArgs}` : "附加参数"}
                      disabled={busy || Boolean(runningScript)}
                      onClick={() => {
                        if (isEditingArgs) {
                          commitScriptArgs(entry.name, draftArgs);
                          return;
                        }
                        openArgsEditor(entry.name);
                      }}
                    >
                      <TextCursorInput size={14} aria-hidden />
                    </button>
                    <button
                      type="button"
                      className={[
                        "package-scripts-args-button",
                        isCopied ? "is-active" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      aria-label={isCopied ? `已复制 ${entry.name} 命令` : `复制 ${entry.name} 命令`}
                      title={isCopied ? "已复制" : `复制 ${runCommand}`}
                      disabled={busy || Boolean(runningScript)}
                      onClick={() => void copyScriptCommand(entry.name, savedArgs || undefined)}
                    >
                      <Copy size={14} aria-hidden />
                    </button>
                    <button
                      type="button"
                      className="package-scripts-run-button"
                      disabled={busy || Boolean(runningScript)}
                      onClick={() => void onRun(entry.name, savedArgs || undefined)}
                    >
                      {isRunning ? (
                        <Loader2 size={14} className="spinning" aria-hidden />
                      ) : (
                        <Play size={14} aria-hidden />
                      )}
                      <span>{isRunning ? "运行中…" : "运行"}</span>
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {showOutput && runState ? (
          <section className="package-scripts-output-section" aria-live="polite">
            <div className="package-scripts-output-head">
              <span className="package-scripts-output-label">
                {runState.script ? `${runState.script} 输出` : "输出"}
              </span>
              {runState.running ? (
                <span className="package-scripts-exit-badge is-running">运行中</span>
              ) : runState.exitCode !== undefined ? (
                <span
                  className={
                    runState.exitCode === 0
                      ? "package-scripts-exit-badge is-success"
                      : "package-scripts-exit-badge is-failure"
                  }
                >
                  exit {runState.exitCode}
                </span>
              ) : null}
            </div>
            <AnsiOutput
              ref={outputRef}
              className="package-scripts-output"
              text={runState.output}
              placeholder={runState.running ? "…" : "（无输出）"}
            />
            {runState.command?.length ? (
              <p className="package-scripts-output-command" title={runState.command.join(" ")}>
                {runState.command.join(" ")}
              </p>
            ) : null}
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
