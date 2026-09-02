import type { File } from "gitdiff-parser";
import { memo, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  type DiffDisplayHunk,
  type DiffDisplayLine,
  fileToDisplayHunks,
  flattenDisplayLines,
} from "./diff-display-lines";
import { highlightDiffDisplayLines, resolveShikiLanguage } from "./diff-shiki-highlight";
import { MaterialFileIcon } from "./MaterialFileIcon";
import {
  countDiffFileStats,
  diffFilePath,
  parseDiff,
  resolveDiffFilePath,
  resolveDiffLanguage,
} from "./prosemirror/diff-from-patch";

export {
  countDiffFileStats,
  parseDiff,
  resolveDiffFilePath,
  resolveDiffLanguage,
} from "./prosemirror/diff-from-patch";

interface GitDiffViewerProps {
  patch: string;
  selectedPath?: string;
  emptyLabel?: string;
  /** @deprecated Ignored — review renders structured patch hunks only. */
  originalContent?: string;
  /** @deprecated Ignored — review renders structured patch hunks only. */
  currentContent?: string;
  additions?: number;
  deletions?: number;
}

function readAppTheme(): "light" | "dark" {
  if (typeof document === "undefined") return "light";
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

function useAppTheme(): "light" | "dark" {
  const [theme, setTheme] = useState<"light" | "dark">(() => readAppTheme());
  useEffect(() => {
    const root = document.documentElement;
    const update = () => setTheme(root.dataset.theme === "dark" ? "dark" : "light");
    update();
    const observer = new MutationObserver(update);
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);
  return theme;
}

const DiffLinesView = memo(function DiffLinesView({
  path,
  hunks,
}: {
  path: string;
  hunks: DiffDisplayHunk[];
}) {
  const theme = useAppTheme();
  const language = useMemo(() => resolveShikiLanguage(path), [path]);
  const flatLines = useMemo(() => flattenDisplayLines(hunks), [hunks]);
  const [lineHtml, setLineHtml] = useState<(string | null)[]>(() => flatLines.map(() => null));

  const lineStarts = useMemo(() => {
    const starts: number[] = [];
    let offset = 0;
    for (const hunk of hunks) {
      starts.push(offset);
      offset += hunk.lines.length;
    }
    return starts;
  }, [hunks]);

  useEffect(() => {
    let active = true;
    setLineHtml(flatLines.map(() => null));
    void highlightDiffDisplayLines(flatLines, language, theme).then((htmls) => {
      if (active) setLineHtml(htmls);
    });
    return () => {
      active = false;
    };
  }, [flatLines, language, theme]);

  return (
    <div className="workspace-diff-code-editor pm-diff-viewer" data-diff-lang={language}>
      {hunks.map((hunk, hunkIndex) => (
        <div className="pm-diff-hunk" key={`hunk-${hunkIndex}`}>
          {hunk.lines.map((line, lineIndex) => {
            const globalIndex = (lineStarts[hunkIndex] ?? 0) + lineIndex;
            const html = lineHtml[globalIndex];
            return (
              <div
                key={`${hunkIndex}-${lineIndex}-${line.kind}-${line.oldNo ?? ""}-${line.newNo ?? ""}`}
                className={`pm-diff-line is-${line.kind}`}
                data-kind={line.kind}
              >
                <span className="pm-diff-line-nos" aria-hidden="true">
                  <span className="pm-diff-line-no pm-diff-line-no--old">
                    {line.oldNo == null ? "" : String(line.oldNo)}
                  </span>
                  <span className="pm-diff-line-no pm-diff-line-no--new">
                    {line.newNo == null ? "" : String(line.newNo)}
                  </span>
                </span>
                {html ? (
                  <span
                    className="pm-diff-line-text is-highlighted"
                    dangerouslySetInnerHTML={{ __html: html }}
                  />
                ) : (
                  <span className="pm-diff-line-text">{line.text.length > 0 ? line.text : "\u00a0"}</span>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
});

export function GitDiffViewer({ patch, selectedPath, emptyLabel, additions, deletions }: GitDiffViewerProps) {
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
    return <p className="workspace-diff-empty">{emptyLabel ?? t("workspace.diff.noChanges")}</p>;
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
          {...(additions !== undefined ? { additions } : {})}
          {...(deletions !== undefined ? { deletions } : {})}
        />
      ))}
    </div>
  );
}

const DiffFileReview = memo(function DiffFileReview({
  file,
  additions,
  deletions,
}: {
  file: File;
  additions?: number;
  deletions?: number;
}) {
  const { t } = useTranslation();
  const path = diffFilePath(file);
  const stats = useMemo(() => {
    if (additions !== undefined && deletions !== undefined) {
      return { additions, deletions };
    }
    return countDiffFileStats(file);
  }, [additions, deletions, file]);
  const hunks = useMemo(() => fileToDisplayHunks(file), [file]);

  return (
    <section className="workspace-diff-file-review">
      <header className="workspace-diff-file-toolbar">
        <div className="workspace-diff-file-identity" title={path}>
          <MaterialFileIcon path={path} size={16} className="workspace-diff-file-icon" />
          <span className="workspace-diff-file-toolbar-path">{path}</span>
          <span
            className="workspace-diff-file-stats"
            aria-label={t("workspace.diff.changedRows", {
              count: stats.additions + stats.deletions,
            })}
          >
            <span className="diff-stat-add">+{stats.additions}</span>
            <span className="diff-stat-del">-{stats.deletions}</span>
          </span>
        </div>
      </header>
      <div className="workspace-diff-code-scroll">
        <DiffLinesView path={path} hunks={hunks} />
      </div>
    </section>
  );
});
