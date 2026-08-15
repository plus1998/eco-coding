import { normalizeColumnCountFixer } from "./normalize-column-count";
import type {
  MarkdownRepair,
  MarkdownTable,
  MarkdownTableAlignment,
  MarkdownTableBlock,
  MarkdownTableDetector,
  MarkdownTableFixer,
  MarkdownTableRepairOptions,
} from "./types";

const FENCE_OPEN = /^( {0,3})(`{3,}|~{3,})(.*)$/;

export const gfmHeaderSeparatorDetector: MarkdownTableDetector = {
  id: "gfm-header-separator",
  detect(lines, startLine) {
    const headerLine = lines[startLine];
    const separatorLine = lines[startLine + 1];
    if (headerLine === undefined || separatorLine === undefined) {
      return null;
    }
    if (matchFenceOpen(headerLine) || matchFenceOpen(separatorLine)) {
      return null;
    }
    if (!lineHasPipe(headerLine) || !isTableSeparator(separatorLine)) {
      return null;
    }

    let endLine = startLine + 2;
    while (endLine < lines.length) {
      const line = lines[endLine];
      if (line === undefined || line.trim() === "") {
        break;
      }
      if (matchFenceOpen(line) || !lineHasPipe(line)) {
        break;
      }
      endLine += 1;
    }

    const header = splitTableRow(headerLine);
    const separator = parseSeparatorAlignments(separatorLine);
    if (header.length === 0 || separator.length === 0) {
      return null;
    }

    const rows: string[][] = [];
    for (let i = startLine + 2; i < endLine; i += 1) {
      const line = lines[i];
      if (line === undefined) {
        continue;
      }
      rows.push(splitTableRow(line));
    }

    return {
      startLine,
      endLine,
      table: { header, separator, rows },
    };
  },
};

export const defaultTableDetectors: readonly MarkdownTableDetector[] = [gfmHeaderSeparatorDetector];

export const defaultTableFixers: readonly MarkdownTableFixer[] = [normalizeColumnCountFixer];

export function createMarkdownTableRepair(options: MarkdownTableRepairOptions = {}): MarkdownRepair {
  const detectors = options.detectors ?? defaultTableDetectors;
  const fixers = options.fixers ?? defaultTableFixers;

  return {
    id: "markdown-table",
    apply(markdown: string): string {
      return rewriteMarkdownTables(markdown, detectors, fixers);
    },
  };
}

export function serializeMarkdownTable(table: MarkdownTable): string[] {
  const lines = [formatTableRow(table.header)];
  if (table.separator) {
    lines.push(formatSeparatorRow(table.separator));
  }
  for (const row of table.rows) {
    lines.push(formatTableRow(row));
  }
  return lines;
}

export function splitTableRow(line: string): string[] {
  let inner = line.trim();
  if (inner.startsWith("|")) {
    inner = inner.slice(1);
  }
  if (inner.endsWith("|") && !isEscapedPipeAt(inner, inner.length - 1)) {
    inner = inner.slice(0, -1);
  }

  const cells: string[] = [];
  let current = "";
  let escaped = false;
  for (const ch of inner) {
    if (escaped) {
      current += ch;
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      current += ch;
      continue;
    }
    if (ch === "|") {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  if (escaped) {
    current += "\\";
  }
  cells.push(current.trim());
  return cells;
}

export function isTableSeparator(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.includes("|") || !trimmed.includes("-")) {
    return false;
  }
  return /^\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/.test(trimmed);
}

function rewriteMarkdownTables(
  markdown: string,
  detectors: readonly MarkdownTableDetector[],
  fixers: readonly MarkdownTableFixer[],
): string {
  if (!markdown) {
    return markdown;
  }

  const { lines, newline, endsWithNewline } = splitMarkdownLines(markdown);
  const out: string[] = [];
  let i = 0;
  let fence: { marker: string } | null = null;

  while (i < lines.length) {
    const line = lines[i];
    if (line === undefined) {
      break;
    }

    if (fence) {
      out.push(line);
      if (isClosingFence(line, fence.marker)) {
        fence = null;
      }
      i += 1;
      continue;
    }

    const open = matchFenceOpen(line);
    if (open) {
      fence = open;
      out.push(line);
      i += 1;
      continue;
    }

    const block = detectTable(lines, i, detectors);
    if (block) {
      const fixed = applyFixers(block.table, fixers);
      if (sameTable(block.table, fixed)) {
        for (let j = block.startLine; j < block.endLine; j += 1) {
          const original = lines[j];
          if (original !== undefined) {
            out.push(original);
          }
        }
      } else {
        out.push(...serializeMarkdownTable(fixed));
      }
      i = block.endLine;
      continue;
    }

    out.push(line);
    i += 1;
  }

  let result = out.join(newline);
  if (endsWithNewline) {
    result += newline;
  }
  return result;
}

function detectTable(
  lines: readonly string[],
  startLine: number,
  detectors: readonly MarkdownTableDetector[],
): MarkdownTableBlock | null {
  for (const detector of detectors) {
    const block = detector.detect(lines, startLine);
    if (block) {
      return block;
    }
  }
  return null;
}

function applyFixers(table: MarkdownTable, fixers: readonly MarkdownTableFixer[]): MarkdownTable {
  let current = table;
  for (const fixer of fixers) {
    current = fixer.apply(current);
  }
  return current;
}

function sameTable(a: MarkdownTable, b: MarkdownTable): boolean {
  if (!sameStringRows(a.header, b.header)) {
    return false;
  }
  if (!sameSeparator(a.separator, b.separator)) {
    return false;
  }
  if (a.rows.length !== b.rows.length) {
    return false;
  }
  return a.rows.every((row, index) => sameStringRows(row, b.rows[index] ?? []));
}

function sameStringRows(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((cell, index) => cell === b[index]);
}

function sameSeparator(a: MarkdownTableAlignment[] | null, b: MarkdownTableAlignment[] | null): boolean {
  if (a === null || b === null) {
    return a === b;
  }
  return a.length === b.length && a.every((item, index) => item === b[index]);
}

function parseSeparatorAlignments(line: string): MarkdownTableAlignment[] {
  return splitTableRow(line).map(alignmentFromCell);
}

function alignmentFromCell(cell: string): MarkdownTableAlignment {
  const trimmed = cell.trim();
  const left = trimmed.startsWith(":");
  const right = trimmed.endsWith(":");
  if (left && right) {
    return "center";
  }
  if (left) {
    return "left";
  }
  if (right) {
    return "right";
  }
  return "none";
}

function formatTableRow(cells: readonly string[]): string {
  return `| ${cells.join(" | ")} |`;
}

function formatSeparatorRow(alignments: readonly MarkdownTableAlignment[]): string {
  return `| ${alignments.map(formatAlignmentCell).join(" | ")} |`;
}

function formatAlignmentCell(alignment: MarkdownTableAlignment): string {
  switch (alignment) {
    case "left":
      return ":---";
    case "right":
      return "---:";
    case "center":
      return ":---:";
    default:
      return "---";
  }
}

function lineHasPipe(line: string): boolean {
  return line.includes("|");
}

function isEscapedPipeAt(text: string, index: number): boolean {
  let slashes = 0;
  for (let i = index - 1; i >= 0 && text[i] === "\\"; i -= 1) {
    slashes += 1;
  }
  return slashes % 2 === 1;
}

function matchFenceOpen(line: string): { marker: string } | null {
  const match = line.match(FENCE_OPEN);
  const marker = match?.[2];
  if (!marker) {
    return null;
  }
  return { marker };
}

function isClosingFence(line: string, openMarker: string): boolean {
  const match = line.match(/^( {0,3})(`{3,}|~{3,})\s*$/);
  const closer = match?.[2];
  if (!closer) {
    return false;
  }
  return closer[0] === openMarker[0] && closer.length >= openMarker.length;
}

function splitMarkdownLines(text: string): {
  lines: string[];
  newline: string;
  endsWithNewline: boolean;
} {
  const newline = text.includes("\r\n") ? "\r\n" : text.includes("\r") ? "\r" : "\n";
  const endsWithNewline = text.endsWith("\n") || text.endsWith("\r");
  const body = endsWithNewline ? text.replace(/\r?\n$/, "").replace(/\r$/, "") : text;
  return {
    lines: body.split(/\r\n|\n|\r/),
    newline,
    endsWithNewline,
  };
}
