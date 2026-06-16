import { useMemo } from "react";
import { Diff, Hunk, parseDiff } from "react-diff-view";
import type { File } from "gitdiff-parser";
import "react-diff-view/style/index.css";

function diffFilePath(file: File): string {
  const raw = file.newPath === "/dev/null" ? file.oldPath : file.newPath;
  return raw.startsWith("b/") ? raw.slice(2) : raw;
}

interface GitDiffViewerProps {
  patch: string;
  selectedPath?: string;
  emptyLabel?: string;
}

export function resolveDiffFilePath(file: File): string {
  return diffFilePath(file);
}

export function GitDiffViewer({
  patch,
  selectedPath,
  emptyLabel = "无变更内容",
}: GitDiffViewerProps) {
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
      {visibleFiles.map((file) => {
        const path = diffFilePath(file);
        return (
          <div key={`${file.oldRevision}-${file.newRevision}-${path}`} className="workspace-diff-file">
            {!selectedPath ? <div className="workspace-diff-file-path">{path}</div> : null}
            <Diff viewType="unified" diffType={file.type} hunks={file.hunks}>
              {(hunks) => hunks.map((hunk) => <Hunk key={hunk.content} hunk={hunk} />)}
            </Diff>
          </div>
        );
      })}
    </div>
  );
}
