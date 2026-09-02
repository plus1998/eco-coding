/** Write a Windows .ico containing PNG-compressed frames (Vista+). */
export function encodeIco(pngFrames) {
  const frames = pngFrames.map((frame) => {
    const data = frame.data instanceof Uint8Array ? frame.data : new Uint8Array(frame.data);
    if (data.byteLength < 8 || data[0] !== 0x89 || data[1] !== 0x50) {
      throw new Error(`ICO frame at ${frame.size}px is not a PNG payload.`);
    }
    return { size: frame.size, data };
  });

  const header = new Uint8Array(6);
  const headerView = new DataView(header.buffer);
  headerView.setUint16(0, 0, true);
  headerView.setUint16(2, 1, true);
  headerView.setUint16(4, frames.length, true);

  const entries = new Uint8Array(frames.length * 16);
  const chunks = [header];
  let offset = 6 + frames.length * 16;

  for (let index = 0; index < frames.length; index++) {
    const { size, data } = frames[index];
    const entry = new DataView(entries.buffer, index * 16, 16);
    entry.setUint8(0, size >= 256 ? 0 : size);
    entry.setUint8(1, size >= 256 ? 0 : size);
    entry.setUint8(2, 0);
    entry.setUint8(3, 0);
    entry.setUint16(4, 1, true);
    entry.setUint16(6, 32, true);
    entry.setUint32(8, data.byteLength, true);
    entry.setUint32(12, offset, true);
    offset += data.byteLength;
    chunks.push(data);
  }

  chunks.splice(1, 0, entries);
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
}

function writeBitmapInfoHeader(view, size) {
  view.setUint32(0, 40, true);
  view.setInt32(4, size, true);
  view.setInt32(8, size * 2, true);
  view.setUint16(12, 1, true);
  view.setUint16(14, 32, true);
  view.setUint32(16, 0, true);
  view.setUint32(20, 0, true);
  view.setInt32(24, 0, true);
  view.setInt32(28, 0, true);
  view.setUint32(32, 0, true);
  view.setUint32(36, 0, true);
}

function rgbaFrameToIcoBitmap(rgba, size) {
  const andRowBytes = Math.ceil(size / 32) * 4;
  const xorBytes = size * size * 4;
  const andBytes = andRowBytes * size;
  const buffer = Buffer.alloc(40 + xorBytes + andBytes);
  writeBitmapInfoHeader(new DataView(buffer.buffer, buffer.byteOffset, 40), size);

  let offset = 40;
  for (let y = size - 1; y >= 0; y--) {
    for (let x = 0; x < size; x++) {
      const source = (y * size + x) * 4;
      buffer[offset++] = rgba[source + 2];
      buffer[offset++] = rgba[source + 1];
      buffer[offset++] = rgba[source];
      buffer[offset++] = rgba[source + 3];
    }
  }
  // AND mask stays zeroed; alpha lives in the 32-bit XOR bitmap.
  return buffer;
}

/** Write a classic 32-bit DIB .ico (best compatibility with Explorer shortcuts). */
export function encodeIcoFromRgba(frames) {
  const bitmaps = frames.map((frame) => {
    const rgba = frame.data instanceof Uint8Array ? frame.data : new Uint8Array(frame.data);
    const expected = frame.size * frame.size * 4;
    if (rgba.byteLength !== expected) {
      throw new Error(
        `ICO frame at ${frame.size}px expected ${expected} RGBA bytes, got ${rgba.byteLength}.`,
      );
    }
    return { size: frame.size, data: rgbaFrameToIcoBitmap(rgba, frame.size) };
  });

  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(bitmaps.length, 4);

  const entries = Buffer.alloc(bitmaps.length * 16);
  const chunks = [header];
  let offset = 6 + bitmaps.length * 16;

  for (let index = 0; index < bitmaps.length; index++) {
    const { size, data } = bitmaps[index];
    const entryOffset = index * 16;
    entries.writeUInt8(size >= 256 ? 0 : size, entryOffset);
    entries.writeUInt8(size >= 256 ? 0 : size, entryOffset + 1);
    entries.writeUInt8(0, entryOffset + 2);
    entries.writeUInt8(0, entryOffset + 3);
    entries.writeUInt16LE(1, entryOffset + 4);
    entries.writeUInt16LE(32, entryOffset + 6);
    entries.writeUInt32LE(data.byteLength, entryOffset + 8);
    entries.writeUInt32LE(offset, entryOffset + 12);
    offset += data.byteLength;
    chunks.push(data);
  }

  chunks.splice(1, 0, entries);
  return Buffer.concat(chunks);
}
