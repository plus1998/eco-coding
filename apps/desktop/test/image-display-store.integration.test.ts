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
