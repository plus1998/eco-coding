import { crc32 } from "node:zlib";
import { inflateSync, deflateSync } from "node:zlib";

const PNG_SIGNATURE = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function readUint32BE(bytes, offset) {
  return (
    (bytes[offset] << 24) |
    (bytes[offset + 1] << 16) |
    (bytes[offset + 2] << 8) |
    bytes[offset + 3]
  ) >>> 0;
}

function writeUint32BE(bytes, offset, value) {
  bytes[offset] = (value >>> 24) & 0xff;
  bytes[offset + 1] = (value >>> 16) & 0xff;
  bytes[offset + 2] = (value >>> 8) & 0xff;
  bytes[offset + 3] = value & 0xff;
}

function paethPredictor(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function unfilterScanline(filterType, row, previous, bytesPerPixel) {
  const output = new Uint8Array(row.length);
  for (let i = 0; i < output.length; i++) {
    const left = i >= bytesPerPixel ? output[i - bytesPerPixel] : 0;
    const up = previous ? previous[i] : 0;
    const upLeft = previous && i >= bytesPerPixel ? previous[i - bytesPerPixel] : 0;
    let value = row[i];
    switch (filterType) {
      case 0:
        break;
      case 1:
        value = (value + left) & 0xff;
        break;
      case 2:
        value = (value + up) & 0xff;
        break;
      case 3:
        value = (value + Math.floor((left + up) / 2)) & 0xff;
        break;
      case 4:
        value = (value + paethPredictor(left, up, upLeft)) & 0xff;
        break;
      default:
        throw new Error(`Unsupported PNG filter type: ${filterType}`);
    }
    output[i] = value;
  }
  return output;
}

function writeChunk(chunks, type, data) {
  const length = new Uint8Array(4);
  writeUint32BE(length, 0, data.byteLength);
  const typeBytes = new TextEncoder().encode(type);
  const crcInput = new Uint8Array(typeBytes.length + data.byteLength);
  crcInput.set(typeBytes, 0);
  crcInput.set(data, typeBytes.length);
  const crc = new Uint8Array(4);
  writeUint32BE(crc, 0, crc32(crcInput) >>> 0);
  chunks.push(length, typeBytes, data, crc);
}

/** Decode 8-bit RGB/RGBA PNG into a tightly packed RGBA buffer. */
export function decodePngToRgba(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.length < 8 || bytes.subarray(0, 8).some((value, index) => value !== PNG_SIGNATURE[index])) {
    throw new Error("Input is not a PNG image.");
  }

  let width = 0;
  let height = 0;
  let colorType = 0;
  const idatParts = [];

  for (let offset = 8; offset + 8 <= bytes.length; ) {
    const length = readUint32BE(bytes, offset);
    const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const chunkData = bytes.subarray(dataStart, dataEnd);

    if (type === "IHDR") {
      width = readUint32BE(chunkData, 0);
      height = readUint32BE(chunkData, 4);
      colorType = chunkData[9];
      if (chunkData[8] !== 8 || (colorType !== 2 && colorType !== 6)) {
        throw new Error(`Unsupported PNG format (bit depth ${chunkData[8]}, color type ${colorType}).`);
      }
    } else if (type === "IDAT") {
      idatParts.push(chunkData);
    } else if (type === "IEND") {
      break;
    }

    offset = dataEnd + 4;
  }

  if (!width || !height || idatParts.length === 0) {
    throw new Error("PNG is missing IHDR or IDAT chunks.");
  }

  const bytesPerPixel = colorType === 6 ? 4 : 3;
  const inflated = inflateSync(Buffer.concat(idatParts.map((part) => Buffer.from(part))));
  const rgba = new Uint8Array(width * height * 4);
  let sourceOffset = 0;
  let previous = null;

  for (let y = 0; y < height; y++) {
    const filterType = inflated[sourceOffset++];
    const row = inflated.subarray(sourceOffset, sourceOffset + width * bytesPerPixel);
    sourceOffset += width * bytesPerPixel;
    const decoded = unfilterScanline(filterType, row, previous, bytesPerPixel);
    previous = decoded;

    for (let x = 0; x < width; x++) {
      const sourceIndex = x * bytesPerPixel;
      const targetIndex = (y * width + x) * 4;
      rgba[targetIndex] = decoded[sourceIndex];
      rgba[targetIndex + 1] = decoded[sourceIndex + 1];
      rgba[targetIndex + 2] = decoded[sourceIndex + 2];
      rgba[targetIndex + 3] = colorType === 6 ? decoded[sourceIndex + 3] : 255;
    }
  }

  return { data: rgba, width, height };
}

/** Encode RGBA pixels as an 8-bit RGBA PNG. */
export function encodeRgbaToPng({ data, width, height }) {
  if (data.length !== width * height * 4) {
    throw new Error("RGBA buffer size does not match image dimensions.");
  }

  const rowSize = width * 4;
  const raw = new Uint8Array((rowSize + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowOffset = y * (rowSize + 1);
    raw[rowOffset] = 0;
    raw.set(data.subarray(y * rowSize, (y + 1) * rowSize), rowOffset + 1);
  }

  const ihdr = new Uint8Array(13);
  writeUint32BE(ihdr, 0, width);
  writeUint32BE(ihdr, 4, height);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const chunks = [PNG_SIGNATURE];
  writeChunk(chunks, "IHDR", ihdr);
  writeChunk(chunks, "IDAT", deflateSync(Buffer.from(raw)));
  writeChunk(chunks, "IEND", new Uint8Array(0));
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
}
