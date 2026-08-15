import type { MarkdownTable, MarkdownTableAlignment, MarkdownTableFixer } from "./types";

/**
 * Pad header, separator, and body so every row has the same column count.
 * Width is the max across header / separator / body — extra cells are kept, not dropped.
 *
 * No-op when there is no separator row (that is a different repair).
 */
export const normalizeColumnCountFixer: MarkdownTableFixer = {
  id: "normalize-column-count",
  apply(table: MarkdownTable): MarkdownTable {
    if (table.separator === null) {
      return table;
    }

    const width = Math.max(
      table.header.length,
      table.separator.length,
      1,
      ...table.rows.map((row) => row.length),
    );

    return {
      header: padCells(table.header, width),
      separator: padAlignments(table.separator, width),
      rows: table.rows.map((row) => padCells(row, width)),
    };
  },
};

function padCells(cells: readonly string[], width: number): string[] {
  if (cells.length >= width) {
    return cells.slice();
  }
  return [...cells, ...Array.from({ length: width - cells.length }, () => "")];
}

function padAlignments(
  alignments: readonly MarkdownTableAlignment[],
  width: number,
): MarkdownTableAlignment[] {
  if (alignments.length >= width) {
    return alignments.slice();
  }
  return [...alignments, ...Array.from({ length: width - alignments.length }, () => "none" as const)];
}
