/** A document-level markdown repair. Later repairs (lists, fences, …) implement this. */
export interface MarkdownRepair {
  id: string;
  apply(markdown: string): string;
}

export type MarkdownTableAlignment = "left" | "right" | "center" | "none";

/**
 * Parsed GFM pipe table.
 * `separator` is null when the block has no alignment row (not rewritten by v1).
 */
export interface MarkdownTable {
  header: string[];
  separator: MarkdownTableAlignment[] | null;
  rows: string[][];
}

export interface MarkdownTableBlock {
  startLine: number;
  /** Exclusive end index in the line array. */
  endLine: number;
  table: MarkdownTable;
}

/** Finds a table starting at `startLine`, or returns null. */
export interface MarkdownTableDetector {
  id: string;
  detect(lines: readonly string[], startLine: number): MarkdownTableBlock | null;
}

export interface MarkdownTableFixer {
  id: string;
  apply(table: MarkdownTable): MarkdownTable;
}

export interface MarkdownTableRepairOptions {
  detectors?: readonly MarkdownTableDetector[];
  fixers?: readonly MarkdownTableFixer[];
}
