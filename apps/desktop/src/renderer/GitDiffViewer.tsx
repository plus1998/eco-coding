import parser, { type Change, type File } from "gitdiff-parser";
import { memo, useMemo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Suspense } from "react";
import { WorkspaceCodeMirror } from "./WorkspaceFilePreview";

function isDelete(change: Change): change is Extract<Change, { type: "delete" }> {
  return change.type === "delete";
}

function isInsert(change: Change): change is Extract<Change, { type: "insert" }> {
  return change.type === "insert";
}

function zipChanges(changes: Change[]): Change[] {
  const result: Change[] = [];
  let last: Change | undefined;
  let lastDeletionIndex = -1;

  for (const change of changes) {
    if (!last) {
      result.push(change);
      last = change;
      if (isDelete(change)) lastDeletionIndex = 0;
      continue;
    }

    if (isInsert(change) && lastDeletionIndex >= 0) {
      result.splice(lastDeletionIndex + 1, 0, change);
      last = change;
      lastDeletionIndex += 1;
      continue;
    }

    result.push(change);
    if (isDelete(change) && !isDelete(last)) {
      lastDeletionIndex = result.length - 1;
    }
    last = change;
  }

  return result;
}

function normalizeDiffText(text: string): string {
  const trimmed = text.trimStart();
  if (trimmed.startsWith("diff --git")) return trimmed;
  const firstBreak = trimmed.indexOf("\n");
  const secondBreak = trimmed.indexOf("\n", firstBreak + 1);
  if (firstBreak < 0 || secondBreak < 0) return trimmed;
  const oldPath = trimmed.slice(0, firstBreak).split(" ").slice(1, -3).join(" ");
  const newPath = trimmed.slice(firstBreak + 1, secondBreak).split(" ").slice(1, -3).join(" ");
  return [
    `diff --git a/${oldPath} b/${newPath}`,
    "index 1111111..2222222 100644",
    `--- a/${oldPath}`,
    `+++ b/${newPath}`,
    trimmed.slice(secondBreak + 1),
  ].join("\n");
}

export function parseDiff(text: string): File[] {
  const files = parser.parse(normalizeDiffText(text));
  return files.map((file) => ({
    ...file,
    hunks: file.hunks.map((hunk) => ({
      ...hunk,
      changes: zipChanges(hunk.changes),
    })),
  }));
}

function diffFilePath(file: File): string {
  const raw = file.newPath === "/dev/null" ? file.oldPath : file.newPath;
  return raw.startsWith("b/") ? raw.slice(2) : raw;
}

export function resolveDiffLanguage(path: string): string | undefined {
  const fileName = path.split("/").at(-1)?.toLowerCase() ?? "";
  if (fileName === "dockerfile") return "shell";
  const extension = fileName.includes(".") ? fileName.split(".").at(-1) : undefined;
  const languageByExtension: Readonly<Record<string, string>> = {
    cjs: "javascript",
    css: "css",
    go: "go",
    htm: "html",
    html: "html",
    java: "java",
    js: "javascript",
    json: "json",
    jsx: "jsx",
    md: "markdown",
    mdx: "markdown",
    mjs: "javascript",
    py: "python",
    rb: "ruby",
    rs: "rust",
    sh: "shell",
    sql: "sql",
    ts: "typescript",
    tsx: "tsx",
    yaml: "yaml",
    yml: "yaml",
    zsh: "shell",
  };
  return extension ? languageByExtension[extension] : undefined;
}

export function countDiffFileStats(file: File): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const hunk of file.hunks) {
    for (const change of hunk.changes) {
      if (isInsert(change)) additions += 1;
      else if (isDelete(change)) deletions += 1;
    }
  }
  return { additions, deletions };
}

function diffFileBadge(path: string): { className: string; content: ReactNode } {
  const name = path.split("/").at(-1)?.toLowerCase() ?? "";
  if (name.endsWith(".tsx") || name.endsWith(".jsx")) {
    return { className: "is-react", content: "R" };
  }
  if (name.endsWith(".css") || name.endsWith(".scss")) {
    return { className: "is-css", content: "CSS" };
  }
  if (name.endsWith(".json") || name.endsWith(".jsonc")) {
    return { className: "is-json", content: "{}" };
  }
  if (name.endsWith(".md") || name.endsWith(".mdx")) {
    return { className: "is-markdown", content: "MD" };
  }
  if (name.endsWith(".ts") || name.endsWith(".mts") || name.endsWith(".cts")) {
    return { className: "is-ts", content: "TS" };
  }
  if (name.endsWith(".js") || name.endsWith(".mjs") || name.endsWith(".cjs")) {
    return { className: "is-js", content: "JS" };
  }
  return { className: "is-code", content: "<>" };
}

interface GitDiffViewerProps {
  patch: string;
  selectedPath?: string;
  emptyLabel?: string;
  originalContent: string;
  currentContent: string;
  additions?: number;
  deletions?: number;
}

export function resolveDiffFilePath(file: File): string {
  return diffFilePath(file);
}

export function GitDiffViewer({
  patch,
  selectedPath,
  emptyLabel,
  originalContent,
  currentContent,
  additions,
  deletions,
}: GitDiffViewerProps) {
  const { t } = useTranslation();
  const files = useMemo(() => {
    const trimmed = patch.trim();
    if (!trimmed) {
      return [];
    }
    try {
      return parseDiff(trimmed);
    } catch {
      return [];
    }
  }, [patch]);

  const visibleFiles = useMemo(() => {
    if (!selectedPath) {
      return files;
    }
    return files.filter((file) => diffFilePath(file) === selectedPath);
  }, [files, selectedPath]);

  if (!patch.trim()) {
    return (
      <p className="workspace-diff-empty">
        {emptyLabel ?? t("workspace.diff.noChanges")}
      </p>
    );
  }

  if (visibleFiles.length === 0) {
    return <p className="workspace-diff-empty">{t("workspace.diff.parseFailed")}</p>;
  }

  return (
    <div className="workspace-diff-viewer">
      {visibleFiles.map((file) => (
        <DiffFileReview
          key={`${file.oldRevision}-${file.newRevision}-${diffFilePath(file)}`}
          file={file}
          originalContent={originalContent}
          currentContent={currentContent}
          additions={additions}
          deletions={deletions}
        />
      ))}
    </div>
  );
}

const DiffFileReview = memo(function DiffFileReview({
  file,
  originalContent,
  currentContent,
  additions,
  deletions,
}: {
  file: File;
  originalContent: string;
  currentContent: string;
  additions?: number;
  deletions?: number;
}) {
  const { t } = useTranslation();
  const path = diffFilePath(file);
  const badge = diffFileBadge(path);
  const stats = useMemo(() => {
    if (additions !== undefined && deletions !== undefined) {
      return { additions, deletions };
    }
    return countDiffFileStats(file);
  }, [additions, deletions, file]);
  const mergePhrases = useMemo(
    () => ({
      "$ unchanged lines": t("workspace.diff.unmodifiedLines"),
    }),
    [t],
  );

  return (
    <section className="workspace-diff-file-review">
      <header className="workspace-diff-file-toolbar">
        <div className="workspace-diff-file-identity" title={path}>
          <span className={`workspace-diff-file-badge ${badge.className}`} aria-hidden>
            {badge.content}
          </span>
          <span className="workspace-diff-file-toolbar-path">{path}</span>
          <span className="workspace-diff-file-stats" aria-label={t("workspace.diff.changedRows", { count: stats.additions + stats.deletions })}>
            <span className="diff-stat-add">+{stats.additions}</span>
            <span className="diff-stat-del">-{stats.deletions}</span>
          </span>
        </div>
      </header>
      <div className="workspace-diff-code-scroll">
        <Suspense fallback={<div className="workspace-diff-code-loading" role="status"><span /><span /><span /></div>}>
          <WorkspaceCodeMirror
            className="workspace-diff-code-editor"
            content={currentContent}
            path={path}
            originalContent={originalContent}
            merge
            mergePhrases={mergePhrases}
          />
        </Suspense>
      </div>
    </section>
  );
});
