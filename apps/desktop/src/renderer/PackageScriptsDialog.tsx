import {
  Copy,
  Loader2,
  PanelRightClose,
  PanelRightOpen,
  Play,
  RefreshCw,
  Square,
  TextCursorInput,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { PackageManagerKind, PackageScriptInfo, PackageScriptRunTarget } from "../shared/ipc";
import { listPackageScriptRunTargets } from "../shared/package-script-target";
import { formatRunCommand } from "../shared/package-script-run";
import { AnsiOutput } from "./AnsiOutput";
import { AppMessage, useAppMessage } from "./AppMessage";
import {
  readWorkspaceScriptArgs,
  saveScriptArgs,
} from "./package-script-args-storage";
import {
  readPackageScriptRunTarget,
  savePackageScriptRunTarget,
} from "./package-script-run-target-storage";

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
  onRun: (scriptName: string, args?: string, target?: PackageScriptRunTarget) => void | Promise<void>;
  onStop?: () => void | Promise<void>;
  onRefresh: () => void | Promise<void>;
}

const PACKAGE_MANAGER_LABELS: Record<PackageManagerKind, string> = {
  bun: "Bun",
  pnpm: "pnpm",
  yarn: "Yarn",
  npm: "npm",
};

const SUCCESS_COLLAPSE_DELAY_MS = 2000;

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
  const [runTarget, setRunTarget] = useState<PackageScriptRunTarget>(() =>
    readPackageScriptRunTarget(window.eco?.platform),
  );
  const [scriptArgsByName, setScriptArgsByName] = useState<Record<string, string>>({});
  const [editingScript, setEditingScript] = useState<string | null>(null);
  const [draftArgs, setDraftArgs] = useState("");
  const [copiedScript, setCopiedScript] = useState<string | null>(null);
  const [outputPanelOpen, setOutputPanelOpen] = useState(false);
  const { showSuccess, dismiss, state: appMessageState } = useAppMessage();
  const outputRef = useRef<HTMLPreElement>(null);
  const argsInputRef = useRef<HTMLInputElement>(null);
  const wasRunningRef = useRef(false);
  const prevOutputLengthRef = useRef(0);
  const dialogOpenedRef = useRef(false);
  const collapseTimerRef = useRef<number | undefined>(undefined);

  const platform = window.eco?.platform ?? "darwin";
  const visibleRunTargets = useMemo(
    () => listPackageScriptRunTargets(platform),
    [platform],
  );
  const isExternalRunTarget = runTarget !== "embedded";
  const runActionLabel = isExternalRunTarget ? "打开" : "运行";
  const runningActionLabel = isExternalRunTarget ? "打开中…" : "运行中…";

  useEffect(() => {
    if (!open) {
      setQuery("");
      setEditingScript(null);
      setDraftArgs("");
      setCopiedScript(null);
      setOutputPanelOpen(false);
      wasRunningRef.current = false;
      prevOutputLengthRef.current = 0;
      dialogOpenedRef.current = false;
      dismiss();
      if (collapseTimerRef.current !== undefined) {
        window.clearTimeout(collapseTimerRef.current);
        collapseTimerRef.current = undefined;
      }
      return;
    }
    if (!dialogOpenedRef.current) {
      dialogOpenedRef.current = true;
      prevOutputLengthRef.current = runState?.output.length ?? 0;
      if (runState?.running) {
        setOutputPanelOpen(true);
      }
    }
    setScriptArgsByName(readWorkspaceScriptArgs(workspacePath));
    setRunTarget(readPackageScriptRunTarget(platform));
  }, [open, workspacePath, platform, dismiss]);

  useEffect(() => {
    const isRunning = runState?.running ?? false;

    if (isRunning) {
      if (collapseTimerRef.current !== undefined) {
        window.clearTimeout(collapseTimerRef.current);
        collapseTimerRef.current = undefined;
      }
      setOutputPanelOpen(true);
      wasRunningRef.current = true;
      return;
    }

    if (wasRunningRef.current && runState?.exitCode === 0) {
      const scriptName = runState.script?.trim() || "脚本";
      showSuccess(`${scriptName} 执行成功`);
      collapseTimerRef.current = window.setTimeout(() => {
        setOutputPanelOpen(false);
        collapseTimerRef.current = undefined;
      }, SUCCESS_COLLAPSE_DELAY_MS);
    }

    wasRunningRef.current = isRunning;
  }, [runState?.running, runState?.exitCode, runState?.script, showSuccess]);

  useEffect(
    () => () => {
      if (collapseTimerRef.current !== undefined) {
        window.clearTimeout(collapseTimerRef.current);
        collapseTimerRef.current = undefined;
      }
    },
    [],
  );

  useEffect(() => {
    const outputLength = runState?.output.length ?? 0;
    if (outputLength === 0) {
      prevOutputLengthRef.current = 0;
      return;
    }
    if (prevOutputLengthRef.current === 0) {
      setOutputPanelOpen(true);
    }
    prevOutputLengthRef.current = outputLength;
  }, [runState?.output]);

  const selectRunTarget = useCallback((target: PackageScriptRunTarget) => {
    setRunTarget(target);
    savePackageScriptRunTarget(target);
  }, []);

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
  const showToolbar = visibleRunTargets.length > 1 || scripts.length > 0;

  return createPortal(
    <>
      {appMessageState ? (
        <div className="package-scripts-message-host">
          <AppMessage
            kind={appMessageState.kind}
            message={appMessageState.message}
            onDismiss={dismiss}
          />
        </div>
      ) : null}
      <div className="package-scripts-backdrop" onMouseDown={onClose}>
      <div
        className={[
          "package-scripts-shell",
          showOutput && outputPanelOpen ? "has-output-panel" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div
          className="package-scripts-dialog"
          role="dialog"
          aria-label="npm scripts"
          aria-modal="true"
        >
          <header className="package-scripts-header">
            <div className="package-scripts-header-text">
              <h2 className="package-scripts-title">npm scripts</h2>
              <p className="package-scripts-subtitle">
                {packageName ? `${packageName} · ` : ""}
                {PACKAGE_MANAGER_LABELS[packageManager]}
              </p>
            </div>
            <div className="package-scripts-header-actions">
              {showOutput && !outputPanelOpen ? (
                <button
                  type="button"
                  className={[
                    "package-scripts-icon-btn",
                    "package-scripts-output-toggle",
                    runState?.exitCode === 0 ? "is-success" : "",
                    runState?.exitCode !== undefined && runState.exitCode !== 0 ? "is-failure" : "",
                    runState?.running ? "is-running" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  aria-label="展开输出"
                  title="展开输出"
                  onClick={() => setOutputPanelOpen(true)}
                >
                  <PanelRightOpen size={15} aria-hidden />
                </button>
              ) : null}
              <button
                type="button"
                className="package-scripts-icon-btn"
                aria-label="刷新脚本列表"
                disabled={busy}
                onClick={() => void onRefresh()}
              >
                <RefreshCw size={15} className={busy ? "spinning" : undefined} />
              </button>
              <button type="button" className="package-scripts-icon-btn" aria-label="关闭" onClick={onClose}>
                <X size={15} />
              </button>
            </div>
          </header>

        {showToolbar ? (
          <div className="package-scripts-toolbar">
            {visibleRunTargets.length > 1 ? (
              <div
                className="package-scripts-run-targets"
                role="tablist"
                aria-label="脚本运行方式"
              >
                {visibleRunTargets.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    role="tab"
                    aria-selected={runTarget === option.value}
                    className={[
                      "package-scripts-run-target",
                      runTarget === option.value ? "is-active" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    disabled={busy || Boolean(runningScript)}
                    onClick={() => selectRunTarget(option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            ) : null}

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
          </div>
        ) : null}

        <div className="package-scripts-body">
          {scripts.length === 0 ? (
            <p className="package-scripts-empty">当前工作区没有可运行的 package.json scripts。</p>
          ) : filteredScripts.length === 0 ? (
            <p className="package-scripts-empty">没有匹配的脚本。</p>
          ) : (
            <ul className="package-scripts-list">
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
                  <li
                    key={entry.name}
                    className={["package-scripts-item", isRunning ? "is-running" : ""]
                      .filter(Boolean)
                      .join(" ")}
                  >
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
                      {isEditingArgs ? (
                        <input
                          ref={argsInputRef}
                          type="text"
                          className="package-scripts-args-input"
                          value={draftArgs}
                          placeholder="附加参数"
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
                          "package-scripts-action-btn",
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
                        className={["package-scripts-action-btn", isCopied ? "is-active" : ""]
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
                        className="package-scripts-run-btn"
                        disabled={busy || Boolean(runningScript)}
                        onClick={() => void onRun(entry.name, savedArgs || undefined, runTarget)}
                      >
                        {isRunning ? (
                          <Loader2 size={13} className="spinning" aria-hidden />
                        ) : (
                          <Play size={13} aria-hidden />
                        )}
                        <span>{isRunning ? runningActionLabel : runActionLabel}</span>
                      </button>
                    </div>
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

        {showOutput && runState ? (
          <aside
            className={["package-scripts-output-panel", outputPanelOpen ? "is-open" : ""]
              .filter(Boolean)
              .join(" ")}
            aria-live="polite"
            aria-label="脚本输出"
          >
            <header className="package-scripts-output-header">
              <div className="package-scripts-output-head">
                <span className="package-scripts-output-label">
                  {runState.script ? runState.script : "输出"}
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
              <div className="package-scripts-output-header-actions">
                {runState.running && onStop ? (
                  <button
                    type="button"
                    className="package-scripts-stop-btn"
                    aria-label="停止脚本"
                    onClick={() => void onStop()}
                  >
                    <Square size={13} aria-hidden />
                    <span>停止</span>
                  </button>
                ) : null}
                <button
                  type="button"
                  className="package-scripts-icon-btn"
                  aria-label="收起输出"
                  title="收起输出"
                  onClick={() => setOutputPanelOpen(false)}
                >
                  <PanelRightClose size={15} aria-hidden />
                </button>
              </div>
            </header>
            <div className="package-scripts-output-body">
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
            </div>
          </aside>
        ) : null}
      </div>
    </div>
    </>,
    document.body,
  );
}
