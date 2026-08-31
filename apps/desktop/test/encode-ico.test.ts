import { expect, test } from "bun:test";
import { encodeIco, encodeIcoFromRgba } from "../scripts/encode-ico.mjs";

test("encodeIco writes a multi-size PNG-based ICO", () => {
  const pngHeader = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const buffer = encodeIco([
    { size: 32, data: pngHeader },
    { size: 256, data: pngHeader },
  ]);

  expect(buffer.subarray(0, 4)).toEqual(Buffer.from([0, 0, 1, 0]));
  expect(buffer.readUInt16LE(4)).toBe(2);
  expect(buffer.subarray(38, 46)).toEqual(Buffer.from(pngHeader));
});

test("encodeIcoFromRgba writes a multi-size 32-bit DIB ICO", () => {
  const size = 16;
  const data = new Uint8Array(size * size * 4);
  for (let index = 0; index < data.length; index += 4) {
    data[index] = 1;
    data[index + 1] = 2;
    data[index + 2] = 3;
    data[index + 3] = 255;
  }

  const buffer = encodeIcoFromRgba([{ size, data }]);
  expect(buffer.subarray(0, 4)).toEqual(Buffer.from([0, 0, 1, 0]));
  expect(buffer.readUInt16LE(4)).toBe(1);
  expect(buffer[6]).toBe(16);
  expect(buffer.readUInt16LE(6)).toBe(32);
});
