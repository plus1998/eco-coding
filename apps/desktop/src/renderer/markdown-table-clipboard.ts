/** Serialize / copy helpers for feed markdown tables (desktop). */

import { copyHtmlToClipboard, copyPngBlobToClipboard, copyTextToClipboard } from "./clipboard";

function escapeMarkdownCell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\n+/g, " ").trim();
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Read visible cell text from a rendered markdown table. */
export function readMarkdownTableMatrix(table: HTMLTableElement): string[][] {
  const rows: string[][] = [];
  for (const tr of Array.from(table.querySelectorAll("tr"))) {
    const cells = Array.from(tr.querySelectorAll("th, td")).map((cell) =>
      (cell.textContent ?? "").replace(/\s+/g, " ").trim(),
    );
    if (cells.length > 0) rows.push(cells);
  }
  return rows;
}

export function tableMatrixToMarkdown(rows: string[][]): string {
  if (rows.length === 0) return "";
  const width = Math.max(...rows.map((row) => row.length));
  if (width < 1) return "";

  const pad = (row: string[]) => {
    const next = row.slice(0, width);
    while (next.length < width) next.push("");
    return next;
  };

  const format = (row: string[]) =>
    `| ${pad(row)
      .map((cell) => escapeMarkdownCell(cell))
      .join(" | ")} |`;

  const header = pad(rows[0] ?? []);
  const separator = `| ${header.map(() => "---").join(" | ")} |`;
  const body = rows.slice(1).map((row) => format(row));
  return [format(header), separator, ...body].join("\n");
}

export function tableMatrixToHtml(rows: string[][]): string {
  if (rows.length === 0) return "";
  const width = Math.max(...rows.map((row) => row.length));
  if (width < 1) return "";

  const pad = (row: string[]) => {
    const next = row.slice(0, width);
    while (next.length < width) next.push("");
    return next;
  };

  const header = pad(rows[0] ?? []);
  let html = "<table><thead><tr>";
  for (const cell of header) {
    html += `<th>${escapeHtml(cell)}</th>`;
  }
  html += "</tr></thead><tbody>";
  for (const row of rows.slice(1)) {
    html += "<tr>";
    for (const cell of pad(row)) {
      html += `<td>${escapeHtml(cell)}</td>`;
    }
    html += "</tr>";
  }
  html += "</tbody></table>";
  return html;
}

export function tableElementToMarkdown(table: HTMLTableElement): string {
  return tableMatrixToMarkdown(readMarkdownTableMatrix(table));
}

export function tableElementToHtml(table: HTMLTableElement): string {
  return tableMatrixToHtml(readMarkdownTableMatrix(table));
}

export async function copyTableAsMarkdown(table: HTMLTableElement): Promise<boolean> {
  return copyTextToClipboard(tableElementToMarkdown(table));
}

export async function copyTableAsHtml(table: HTMLTableElement): Promise<boolean> {
  const html = tableElementToHtml(table);
  // text/plain must also be HTML — many editors only paste plain and were getting Markdown.
  return copyHtmlToClipboard(html, html);
}

type CapturePalette = {
  bg: string;
  text: string;
  muted: string;
  border: string;
  headBg: string;
};

function capturePalette(): CapturePalette {
  const light = document.documentElement.dataset.theme === "light";
  return light
    ? {
        bg: "#ffffff",
        text: "#1d1d1f",
        muted: "#6e6e73",
        border: "#d1d1d6",
        headBg: "#f5f5f7",
      }
    : {
        bg: "#1c1c1c",
        text: "#f5f5f5",
        muted: "#c8c8c8",
        border: "#2e2e2e",
        headBg: "#252525",
      };
}

function padMatrix(rows: string[][]): string[][] {
  const width = Math.max(0, ...rows.map((row) => row.length));
  return rows.map((row) => {
    const next = row.slice(0, width);
    while (next.length < width) next.push("");
    return next;
  });
}

function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  if (!text) return [""];
  const lines: string[] = [];
  let current = "";
  for (const ch of text) {
    const next = current + ch;
    if (current && ctx.measureText(next).width > maxWidth) {
      lines.push(current);
      current = ch;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [""];
}

const CELL_PAD_X = 16;
const CELL_PAD_Y = 10;
const FONT_SIZE = 14;
const LINE_HEIGHT = Math.ceil(FONT_SIZE * 1.45);
const OUTER_PAD = 16;
const MAX_COL_WIDTH = 360;
const MIN_COL_WIDTH = 48;

/**
 * Paint the table matrix onto a canvas (no DOM/SVG capture — Electron-stable).
 * Exported for tests that stub canvas.
 */
export function paintTableMatrixToCanvas(
  rows: string[][],
  palette: CapturePalette,
  options?: { pixelRatio?: number },
): HTMLCanvasElement | null {
  const matrix = padMatrix(rows);
  if (matrix.length === 0 || (matrix[0]?.length ?? 0) < 1) return null;

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const bodyFont = `${FONT_SIZE}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
  const headFont = `600 ${FONT_SIZE}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
  const colCount = matrix[0]!.length;

  const colWidths: number[] = Array.from({ length: colCount }, () => MIN_COL_WIDTH);
  for (let r = 0; r < matrix.length; r += 1) {
    ctx.font = r === 0 ? headFont : bodyFont;
    for (let c = 0; c < colCount; c += 1) {
      const textWidth = ctx.measureText(matrix[r]![c] ?? "").width;
      colWidths[c] = Math.min(MAX_COL_WIDTH, Math.max(colWidths[c]!, Math.ceil(textWidth) + CELL_PAD_X * 2));
    }
  }

  const cellLines: string[][][] = matrix.map((row, r) => {
    ctx.font = r === 0 ? headFont : bodyFont;
    return row.map((cell, c) => wrapLines(ctx, cell, Math.max(8, colWidths[c]! - CELL_PAD_X * 2)));
  });

  const rowHeights = cellLines.map((row) => {
    const lines = Math.max(1, ...row.map((lines) => lines.length));
    return lines * LINE_HEIGHT + CELL_PAD_Y * 2;
  });

  const tableWidth = colWidths.reduce((sum, w) => sum + w, 0);
  const tableHeight = rowHeights.reduce((sum, h) => sum + h, 0);
  const cssWidth = tableWidth + OUTER_PAD * 2;
  const cssHeight = tableHeight + OUTER_PAD * 2;
  const pixelRatio = Math.max(1, Math.min(2, options?.pixelRatio ?? (window.devicePixelRatio || 1)));

  canvas.width = Math.ceil(cssWidth * pixelRatio);
  canvas.height = Math.ceil(cssHeight * pixelRatio);
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;
  ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);

  ctx.fillStyle = palette.bg;
  ctx.fillRect(0, 0, cssWidth, cssHeight);

  let y = OUTER_PAD;
  for (let r = 0; r < matrix.length; r += 1) {
    let x = OUTER_PAD;
    const rowHeight = rowHeights[r]!;
    for (let c = 0; c < colCount; c += 1) {
      const colWidth = colWidths[c]!;
      ctx.fillStyle = r === 0 ? palette.headBg : palette.bg;
      ctx.fillRect(x, y, colWidth, rowHeight);
      ctx.strokeStyle = palette.border;
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, colWidth - 1, rowHeight - 1);

      ctx.fillStyle = r === 0 ? palette.muted : palette.text;
      ctx.font = r === 0 ? headFont : bodyFont;
      ctx.textBaseline = "top";
      const lines = cellLines[r]![c]!;
      let textY = y + CELL_PAD_Y;
      for (const line of lines) {
        ctx.fillText(line, x + CELL_PAD_X, textY);
        textY += LINE_HEIGHT;
      }
      x += colWidth;
    }
    y += rowHeight;
  }

  return canvas;
}

function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), "image/png");
  });
}

/** Canvas-painted PNG — avoids html-to-image / SVG foreignObject white frames in Electron. */
export async function copyTableAsImage(table: HTMLTableElement): Promise<boolean> {
  const rows = readMarkdownTableMatrix(table);
  if (rows.length === 0) return false;

  const canvas = paintTableMatrixToCanvas(rows, capturePalette());
  if (!canvas) return false;

  const blob = await canvasToPngBlob(canvas);
  if (!blob || blob.size < 32) return false;
  return copyPngBlobToClipboard(blob);
}
