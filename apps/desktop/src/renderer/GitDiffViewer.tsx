import type { File } from "gitdiff-parser";
import { Columns2, FileCode2, Rows3, ScanLine } from "lucide-react";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Diff, Hunk, markEdits, parseDiff, tokenize } from "react-diff-view";
import refractor from "refractor/core";
import bash from "refractor/lang/bash";
import css from "refractor/lang/css";
import go from "refractor/lang/go";
import java from "refractor/lang/java";
import json from "refractor/lang/json";
import markdown from "refractor/lang/markdown";
import python from "refractor/lang/python";
import rust from "refractor/lang/rust";
import sql from "refractor/lang/sql";
import tsx from "refractor/lang/tsx";
import yaml from "refractor/lang/yaml";
import "react-diff-view/style/index.css";

const DIFF_SPLIT_MIN_WIDTH_PX = 860;

for (const language of [tsx, css, json, bash, python, rust, go, java, yaml, markdown, sql]) {
  if (!refractor.registered(language.displayName)) {
    refractor.register(language);
  }
}

type DiffViewPreference = "auto" | "unified" | "split";
type DiffViewType = "unified" | "split";

const diffViewOptions: ReadonlyArray<{
  value: DiffViewPreference;
  label: string;
  icon: typeof ScanLine;
}> = [
  { value: "auto", label: "自适应", icon: ScanLine },
  { value: "unified", label: "单栏", icon: Rows3 },
  { value: "split", label: "并排", icon: Columns2 },
];

const languageByExtension: Readonly<Record<string, string>> = {
  bash: "bash",
  cjs: "javascript",
  css: "css",
  go: "go",
  htm: "markup",
  html: "markup",
  java: "java",
  js: "javascript",
  json: "json",
  jsx: "jsx",
  md: "markdown",
  mdx: "markdown",
  mjs: "javascript",
  py: "python",
  rs: "rust",
  sh: "bash",
  sql: "sql",
  ts: "typescript",
  tsx: "tsx",
  yaml: "yaml",
  yml: "yaml",
  zsh: "bash",
};

function diffFilePath(file: File): string {
  const raw = file.newPath === "/dev/null" ? file.oldPath : file.newPath;
  return raw.startsWith("b/") ? raw.slice(2) : raw;
}

export function resolveDiffLanguage(path: string): string | undefined {
  const fileName = path.split("/").at(-1)?.toLowerCase() ?? "";
  if (fileName === "dockerfile") {
    return "bash";
  }
  const extension = fileName.includes(".") ? fileName.split(".").at(-1) : undefined;
  return extension ? languageByExtension[extension] : undefined;
}

interface GitDiffViewerProps {
  patch: string;
  selectedPath?: string;
  emptyLabel?: string;
}

export function resolveDiffFilePath(file: File): string {
  return diffFilePath(file);
}

export function GitDiffViewer({ patch, selectedPath, emptyLabel = "无变更内容" }: GitDiffViewerProps) {
  const files = useMemo(() => {
    const trimmed = patch.trim();
    if (!trimmed) {
      return [];
    }
    try {
      return parseDiff(trimmed, { nearbySequences: "zip" });
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
    return <p className="workspace-diff-empty">{emptyLabel}</p>;
  }

  if (visibleFiles.length === 0) {
    return <p className="workspace-diff-empty">无法解析 diff 内容</p>;
  }

  return (
    <div className="workspace-diff-viewer">
      {visibleFiles.map((file) => (
        <DiffFileReview key={`${file.oldRevision}-${file.newRevision}-${diffFilePath(file)}`} file={file} />
      ))}
    </div>
  );
}

const DiffFileReview = memo(function DiffFileReview({ file }: { file: File }) {
  const reviewRef = useRef<HTMLElement>(null);
  const [viewPreference, setViewPreference] = useState<DiffViewPreference>("auto");
  const [autoViewType, setAutoViewType] = useState<DiffViewType>("unified");
  const path = diffFilePath(file);
  const pathSeparatorIndex = path.lastIndexOf("/");
  const fileName = pathSeparatorIndex >= 0 ? path.slice(pathSeparatorIndex + 1) : path;
  const directory = pathSeparatorIndex >= 0 ? path.slice(0, pathSeparatorIndex) : undefined;
  const language = resolveDiffLanguage(path);
  const viewType = viewPreference === "auto" ? autoViewType : viewPreference;
  const changeCount = useMemo(
    () => file.hunks.reduce((total, hunk) => total + hunk.changes.length, 0),
    [file.hunks],
  );
  const tokens = useMemo(() => {
    const enhancers = [markEdits(file.hunks, { type: "block" })];
    return language
      ? tokenize(file.hunks, { highlight: true, refractor, language, enhancers })
      : tokenize(file.hunks, { enhancers });
  }, [file.hunks, language]);

  useEffect(() => {
    const review = reviewRef.current;
    if (!review) {
      return;
    }
    const updateViewType = (width: number) => {
      setAutoViewType(width >= DIFF_SPLIT_MIN_WIDTH_PX ? "split" : "unified");
    };
    updateViewType(review.clientWidth);
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        updateViewType(entry.contentRect.width);
      }
    });
    observer.observe(review);
    return () => observer.disconnect();
  }, []);

  return (
    <section ref={reviewRef} className="workspace-diff-file-review" data-view-type={viewType}>
      <header className="workspace-diff-file-toolbar">
        <div className="workspace-diff-file-identity" title={path}>
          <FileCode2 size={15} aria-hidden />
          <span className="workspace-diff-file-name">{fileName}</span>
          {directory ? <span className="workspace-diff-file-directory">{directory}</span> : null}
        </div>
        <div className="workspace-diff-file-toolbar-meta">
          {language ? <span>{language}</span> : null}
          <span>{changeCount} 行变更</span>
        </div>
        <fieldset className="workspace-diff-view-segmented">
          <legend>代码对比布局</legend>
          {diffViewOptions.map((option) => {
            const Icon = option.icon;
            const selected = viewPreference === option.value;
            return (
              <button
                key={option.value}
                type="button"
                className={selected ? "is-active" : ""}
                aria-pressed={selected}
                title={option.label}
                onClick={() => setViewPreference(option.value)}
              >
                <Icon size={13} aria-hidden />
                <span>{option.label}</span>
              </button>
            );
          })}
        </fieldset>
      </header>
      <div className="workspace-diff-code-scroll">
        <Diff
          viewType={viewType}
          diffType={file.type}
          hunks={file.hunks}
          tokens={tokens}
          optimizeSelection={viewType === "split"}
          className="workspace-diff-code-table"
        >
          {(hunks) => hunks.map((hunk) => <Hunk key={hunk.content} hunk={hunk} />)}
        </Diff>
      </div>
    </section>
  );
});
