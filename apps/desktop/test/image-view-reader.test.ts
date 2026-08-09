import { afterEach, expect, test } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { IMAGE_VIEW_MAX_BYTES, ImageViewReadError, readImageViewFile } from "../src/main/image-view-reader";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

async function createTemporaryDirectory(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "eco-image-view-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

test("readImageViewFile returns a signature-verified local image", async () => {
  const directory = await createTemporaryDirectory();
  const imagePath = path.join(directory, "preview.bin");
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  );
  await fs.writeFile(imagePath, png);

  const result = await readImageViewFile(imagePath);

  expect(result.mimeType).toBe("image/png");
  expect(result.fileName).toBe("preview.bin");
  expect(result.bytes).toBe(png.length);
  expect(result.width).toBe(1);
  expect(result.height).toBe(1);
  expect(Buffer.from(result.dataBase64, "base64")).toEqual(png);
});

test("readImageViewFile rejects unsupported content instead of trusting an extension", async () => {
  const directory = await createTemporaryDirectory();
  const imagePath = path.join(directory, "not-an-image.png");
  await fs.writeFile(imagePath, "plain text");

  await expect(readImageViewFile(imagePath)).rejects.toMatchObject({
    name: "ImageViewReadError",
    code: "unsupported_type",
  });
});

test("readImageViewFile rejects symbolic links", async () => {
  const directory = await createTemporaryDirectory();
  const targetPath = path.join(directory, "target.png");
  const linkPath = path.join(directory, "link.png");
  await fs.writeFile(targetPath, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  await fs.symlink(targetPath, linkPath);

  await expect(readImageViewFile(linkPath)).rejects.toMatchObject({
    name: "ImageViewReadError",
    code: new ImageViewReadError("symbolic_link").code,
  });
});

test("readImageViewFile enforces the Feed size limit before reading", async () => {
  const directory = await createTemporaryDirectory();
  const imagePath = path.join(directory, "oversized.png");
  await fs.writeFile(imagePath, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  await fs.truncate(imagePath, IMAGE_VIEW_MAX_BYTES + 1);

  await expect(readImageViewFile(imagePath)).rejects.toMatchObject({ code: "too_large" });
});

test("readImageViewFile reports an execution-environment path that is not local", async () => {
  const missingPath = path.join(os.tmpdir(), `eco-image-view-missing-${Date.now()}.png`);
  await expect(readImageViewFile(missingPath)).rejects.toMatchObject({ code: "not_found" });
});
