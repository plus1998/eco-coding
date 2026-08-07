import type { File } from "gitdiff-parser";
import type { DiffLineKind } from "./prosemirror/diff-viewer-schema";

export interface DiffDisplayLine {
  kind: DiffLineKind;
  text: string;
  oldNo: number | null;
  newNo: number | null;
}

export interface DiffDisplayHunk {
  lines: DiffDisplayLine[];
}

function isDelete(type: string): boolean {
  return type === "delete";
}

function isInsert(type: string): boolean {
  return type === "insert";
}

export function fileToDisplayHunks(file: File): DiffDisplayHunk[] {
  return file.hunks.map((hunk) => ({
    lines: hunk.changes.map((change) => {
      if (isInsert(change.type)) {
        return {
          kind: "insert" as const,
          oldNo: null,
          newNo: "lineNumber" in change ? change.lineNumber : null,
          text: change.content,
        };
      }
      if (isDelete(change.type)) {
        return {
          kind: "delete" as const,
          oldNo: "lineNumber" in change ? change.lineNumber : null,
          newNo: null,
          text: change.content,
        };
      }
      return {
        kind: "context" as const,
        oldNo: "oldLineNumber" in change ? change.oldLineNumber : null,
        newNo: "newLineNumber" in change ? change.newLineNumber : null,
        text: change.content,
      };
    }),
  }));
}

export function flattenDisplayLines(hunks: DiffDisplayHunk[]): DiffDisplayLine[] {
  return hunks.flatMap((hunk) => hunk.lines);
}
