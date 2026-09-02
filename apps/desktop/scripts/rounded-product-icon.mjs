import { decodePngToRgba, encodeRgbaToPng } from "./png-rgba.mjs";

/** Windows shell-style corner radius (~14% of edge; 72px at 512). */
export const WINDOWS_CORNER_FRACTION = 72 / 512;

/**
 * Coverage of a pixel center inside a rounded square [0, size).
 * Uses circular corner arcs; values near the edge are anti-aliased.
 */
export function roundedRectCoverage(px, py, size, radius) {
  if (px >= radius && px <= size - radius) return 1;
  if (py >= radius && py <= size - radius) return 1;

  let cx;
  let cy;
  if (px < radius && py < radius) {
    cx = radius;
    cy = radius;
  } else if (px > size - radius && py < radius) {
    cx = size - radius;
    cy = radius;
  } else if (px < radius && py > size - radius) {
    cx = radius;
    cy = size - radius;
  } else if (px > size - radius && py > size - radius) {
    cx = size - radius;
    cy = size - radius;
  } else {
    return 1;
  }

  const dx = px - cx;
  const dy = py - cy;
  const distance = Math.hypot(dx, dy);
  if (distance <= radius - 0.5) return 1;
  if (distance >= radius + 0.5) return 0;
  return radius + 0.5 - distance;
}

function sampleCoverage(x, y, size, radius, samplesPerAxis) {
  const step = 1 / samplesPerAxis;
  let total = 0;
  for (let sy = 0; sy < samplesPerAxis; sy++) {
    for (let sx = 0; sx < samplesPerAxis; sx++) {
      total += roundedRectCoverage(x + (sx + 0.5) * step, y + (sy + 0.5) * step, size, radius);
    }
  }
  return total / (samplesPerAxis * samplesPerAxis);
}

/**
 * Bake rounded corners with transparent pixels outside the product shape.
 * Opaque white fills are invisible on this logo and look square on the desktop.
 */
export function applyTransparentRoundedProductIcon(rgba, width, height, cornerFraction, samplesPerAxis = 4) {
  if (rgba.length !== width * height * 4) {
    throw new Error("RGBA buffer size does not match image dimensions.");
  }

  const radius = width * cornerFraction;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const coverage = sampleCoverage(x, y, width, radius, samplesPerAxis);
      const index = (y * width + x) * 4;
      const alpha = Math.round(coverage * 255);
      rgba[index + 3] = alpha;
      if (alpha === 0) {
        rgba[index] = 0;
        rgba[index + 1] = 0;
        rgba[index + 2] = 0;
      }
    }
  }

  return rgba;
}

export function bakeTransparentRoundedPng(pngBytes, cornerFraction = WINDOWS_CORNER_FRACTION) {
  const decoded = decodePngToRgba(pngBytes);
  applyTransparentRoundedProductIcon(decoded.data, decoded.width, decoded.height, cornerFraction);
  return encodeRgbaToPng(decoded);
}
