import { expect, test } from "bun:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decodePngToRgba, encodeRgbaToPng } from "../scripts/png-rgba.mjs";
import {
  applyTransparentRoundedProductIcon,
  bakeTransparentRoundedPng,
  roundedRectCoverage,
  WINDOWS_CORNER_FRACTION,
} from "../scripts/rounded-product-icon.mjs";

test("roundedRectCoverage is 0 in square corners and 1 in the center", () => {
  expect(roundedRectCoverage(0.5, 0.5, 64, 9)).toBe(0);
  expect(roundedRectCoverage(32, 32, 64, 9)).toBe(1);
});

test("applyTransparentRoundedProductIcon clears clipped corners", () => {
  const width = 64;
  const height = 64;
  const data = new Uint8Array(width * height * 4);
  for (let index = 0; index < data.length; index += 4) {
    data[index] = 10;
    data[index + 1] = 20;
    data[index + 2] = 30;
    data[index + 3] = 255;
  }

  applyTransparentRoundedProductIcon(data, width, height, WINDOWS_CORNER_FRACTION);

  expect(data[0]).toBe(0);
  expect(data[1]).toBe(0);
  expect(data[2]).toBe(0);
  expect(data[3]).toBe(0);

  const center = (32 * width + 32) * 4;
  expect(data[center]).toBe(10);
  expect(data[center + 1]).toBe(20);
  expect(data[center + 2]).toBe(30);
  expect(data[center + 3]).toBe(255);
});

test("png rgba round-trip preserves opaque pixels", () => {
  const width = 8;
  const height = 8;
  const data = new Uint8Array(width * height * 4);
  for (let index = 0; index < data.length; index += 4) {
    data[index] = 12;
    data[index + 1] = 34;
    data[index + 2] = 56;
    data[index + 3] = 255;
  }

  const encoded = encodeRgbaToPng({ data, width, height });
  const decoded = decodePngToRgba(encoded);
  expect(decoded.width).toBe(width);
  expect(decoded.height).toBe(height);
  expect(decoded.data).toEqual(data);
});

test("bakeTransparentRoundedPng returns transparent corners", async () => {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
  const sourceLogo = path.join(repoRoot, "logo.png");
  const resized = await Bun.file(sourceLogo).image().resize(64, 64, { fit: "fill" }).png().bytes();
  const baked = bakeTransparentRoundedPng(resized);
  const decoded = decodePngToRgba(baked);

  expect(decoded.width).toBe(64);
  expect(decoded.data[3]).toBe(0);
});
