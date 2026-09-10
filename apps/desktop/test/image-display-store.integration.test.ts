import { afterEach, expect, test } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createImageDisplayStore } from "../src/main/image-display-store";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

const roots: string[] = [];
const stores: Array<{ close(): void }> = [];

afterEach(async () => {
  for (const store of stores.splice(0)) {
    store.close();
  }
  await Promise.all(
    roots.splice(0).map(async (root) => {
      try {
        await fs.rm(root, { recursive: true, force: true });
      } catch {
        // Windows temp lock
      }
    }),
  );
});

async function createStore() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "eco-image-display-store-"));
  roots.push(root);
  const store = await createImageDisplayStore(path.join(root, "display.db"), path.join(root, "files"));
  stores.push(store);
  return { store, root };
}

test("ingest path copies local image into artifact store", async () => {
  const { store, root } = await createStore();
  const sourcePath = path.join(root, "source.png");
  await fs.writeFile(sourcePath, PNG);
  const artifact = await store.ingestFromToolInput({
    threadId: "thr_path",
    toolInput: { source: "path", path: sourcePath, title: "本地图" },
  });
  expect(artifact.sourceKind).toBe("path");
  expect(artifact.mimeType).toBe("image/png");
  const file = await store.readArtifactFile(artifact.id);
  expect(file.dataBase64).toBe(PNG.toString("base64"));
  expect(file.fileName).toMatch(/\.png$/);
});

test("ingest base64 stores decoded bytes", async () => {
  const { store } = await createStore();
  const artifact = await store.ingestFromToolInput({
    threadId: "thr_b64",
    toolInput: { source: "base64", data: PNG.toString("base64"), mimeType: "image/png" },
  });
  expect(artifact.bytes).toBe(PNG.length);
  const file = await store.readArtifactFile(artifact.id);
  expect(Buffer.from(file.dataBase64, "base64").equals(PNG)).toBe(true);
});

test("readArtifactFile supports byte-range chunks", async () => {
  const { store } = await createStore();
  const artifact = await store.ingestFromToolInput({
    threadId: "thr_chunk",
    toolInput: { source: "base64", data: PNG.toString("base64"), mimeType: "image/png" },
  });
  const first = await store.readArtifactFile(artifact.id, { offset: 0, length: 8 });
  expect(first.offset).toBe(0);
  expect(first.chunkBytes).toBe(8);
  expect(first.totalBytes).toBe(PNG.length);
  expect(Buffer.from(first.dataBase64, "base64").equals(PNG.subarray(0, 8))).toBe(true);
  const rest = await store.readArtifactFile(artifact.id, {
    offset: 8,
    length: PNG.length,
  });
  expect(rest.offset).toBe(8);
  expect(rest.chunkBytes).toBe(PNG.length - 8);
  expect(
    Buffer.concat([
      Buffer.from(first.dataBase64, "base64"),
      Buffer.from(rest.dataBase64, "base64"),
    ]).equals(PNG),
  ).toBe(true);
});
