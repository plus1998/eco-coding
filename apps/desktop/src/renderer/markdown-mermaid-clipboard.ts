/** Serialize / copy helpers for feed Mermaid diagrams (desktop). */

import { copyPngBlobToClipboard, copyTextToClipboard } from "./clipboard";

/** Wrap Mermaid source as a fenced Markdown code block. */
export function mermaidSourceToMarkdown(source: string): string {
  const body = source.replace(/\r\n/g, "\n").replace(/^\n+|\n+$/g, "");
  if (!body.trim()) return "";
  return ["```mermaid", body, "```"].join("\n");
}

export async function copyMermaidAsMarkdown(source: string): Promise<boolean> {
  return copyTextToClipboard(mermaidSourceToMarkdown(source));
}

type CapturePalette = {
  bg: string;
};

function captureBackground(): CapturePalette {
  const light = document.documentElement.dataset.theme === "light";
  return { bg: light ? "#ffffff" : "#1c1c1c" };
}

function readSvgSize(svg: SVGSVGElement): { width: number; height: number } | null {
  try {
    const vb = svg.viewBox?.baseVal;
    if (vb && vb.width > 0 && vb.height > 0) {
      return { width: vb.width, height: vb.height };
    }
  } catch {
    // ignore invalid viewBox
  }
  const attrW = Number.parseFloat(svg.getAttribute("width") || "");
  const attrH = Number.parseFloat(svg.getAttribute("height") || "");
  if (Number.isFinite(attrW) && Number.isFinite(attrH) && attrW > 0 && attrH > 0) {
    return { width: attrW, height: attrH };
  }
  return null;
}

/**
 * Normalize Mermaid SVG markup for canvas capture: xmlns, explicit size, solid background.
 * Exported for unit tests.
 */
export function prepareMermaidSvgForCapture(
  svgHtml: string,
  background: string,
): { markup: string; width: number; height: number } | null {
  const trimmed = svgHtml.trim();
  if (!trimmed) return null;

  const host = document.createElement("div");
  host.innerHTML = trimmed;
  const svg = host.querySelector("svg");
  if (!(svg instanceof SVGSVGElement)) return null;

  const size = readSvgSize(svg);
  if (!size) return null;

  svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  svg.setAttribute("width", String(size.width));
  svg.setAttribute("height", String(size.height));

  const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  bg.setAttribute("x", "0");
  bg.setAttribute("y", "0");
  bg.setAttribute("width", "100%");
  bg.setAttribute("height", "100%");
  bg.setAttribute("fill", background);
  svg.insertBefore(bg, svg.firstChild);

  return {
    markup: new XMLSerializer().serializeToString(svg),
    width: size.width,
    height: size.height,
  };
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to decode Mermaid SVG"));
    img.src = url;
  });
}

function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), "image/png");
  });
}

/**
 * Rasterize Mermaid SVG to PNG via Image + canvas (same paste path as table copy-as-image).
 */
export async function mermaidSvgToPngBlob(
  svgHtml: string,
  options?: { pixelRatio?: number; background?: string },
): Promise<Blob | null> {
  const background = options?.background ?? captureBackground().bg;
  const prepared = prepareMermaidSvgForCapture(svgHtml, background);
  if (!prepared) return null;

  const pixelRatio = Math.max(1, Math.min(2, options?.pixelRatio ?? (window.devicePixelRatio || 1)));
  const cssWidth = prepared.width;
  const cssHeight = prepared.height;
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(prepared.markup)}`;

  let img: HTMLImageElement;
  try {
    img = await loadImage(url);
  } catch {
    return null;
  }

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  canvas.width = Math.ceil(cssWidth * pixelRatio);
  canvas.height = Math.ceil(cssHeight * pixelRatio);
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;
  ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, cssWidth, cssHeight);
  ctx.drawImage(img, 0, 0, cssWidth, cssHeight);

  const blob = await canvasToPngBlob(canvas);
  if (!blob || blob.size < 32) return null;
  return blob;
}

export async function copyMermaidAsImage(svgHtml: string): Promise<boolean> {
  const blob = await mermaidSvgToPngBlob(svgHtml);
  if (!blob) return false;
  return copyPngBlobToClipboard(blob);
}
