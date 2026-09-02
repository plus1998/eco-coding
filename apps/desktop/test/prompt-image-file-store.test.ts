import { afterEach, expect, test } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { isPromptImageAttachmentRecord, PromptImageFileStore } from "../src/main/prompt-image-file-store";

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    const directory = tempDirs.pop();
    if (directory) {
      await fs.rm(directory, { recursive: true, force: true });
    }
  }
});

async function createStore(): Promise<PromptImageFileStore> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "eco-prompt-image-store-"));
  tempDirs.push(directory);
  return new PromptImageFileStore(directory);
}

test("stages composer images under the context spool and deletes them on release", async () => {
  const store = await createStore();
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).toString("base64");
  const staged = await store.stageComposerImage({
    contextKey: "thread:thr_1",
    imageId: "img_1",
    mediaType: "image/png",
    dataBase64: png,
  });

  expect(store.isManagedPath(staged.path)).toBe(true);
  await expect(fs.stat(staged.path)).resolves.toBeDefined();

  await store.releasePaths([staged.path]);
  await expect(fs.stat(staged.path)).rejects.toMatchObject({ code: "ENOENT" });
});

test("deleteSpoolContext removes the entire composer spool directory", async () => {
  const store = await createStore();
  const staged = await store.stageComposerImage({
    contextKey: "landing:/tmp/project",
    imageId: "img_2",
    mediaType: "image/jpeg",
    dataBase64: Buffer.from("jpeg").toString("base64"),
  });
  expect(staged.path).toContain(`${path.sep}spool${path.sep}`);

  await store.deleteSpoolContext("landing:/tmp/project");
  await expect(fs.stat(staged.path)).rejects.toMatchObject({ code: "ENOENT" });
});

test("persistMessageAttachments moves spool files into message storage", async () => {
  const store = await createStore();
  const staged = await store.stageComposerImage({
    contextKey: "thread:thr_move",
    imageId: "img_move",
    mediaType: "image/png",
    dataBase64: Buffer.from("png").toString("base64"),
  });

  const persisted = await store.persistMessageAttachments("thr_move", "user:abc", [
    { mediaType: "image/png", path: staged.path },
  ]);

  expect(persisted).toEqual([
    {
      mediaType: "image/png",
      path: expect.stringContaining(`${path.sep}messages${path.sep}thr_move${path.sep}user_abc${path.sep}`),
    },
  ]);
  await expect(fs.stat(staged.path)).rejects.toMatchObject({ code: "ENOENT" });
  await expect(fs.stat(persisted[0]!.path!)).resolves.toBeDefined();
});

test("resolveAttachmentsForRuntime reads managed files back as base64", async () => {
  const store = await createStore();
  const payload = Buffer.from("runtime").toString("base64");
  const persisted = await store.persistMessageAttachments("thr_runtime", "codex-pending:1", [
    { mediaType: "image/webp", data: payload },
  ]);

  const resolved = await store.resolveAttachmentsForRuntime(persisted);
  expect(resolved).toEqual([
    {
      mediaType: "image/webp",
      data: payload,
      path: persisted[0]?.path,
    },
  ]);
});

test("deleteThreadMessages removes all message-owned prompt images", async () => {
  const store = await createStore();
  const persisted = await store.persistMessageAttachments("thr_delete", "user:1", [
    { mediaType: "image/png", data: Buffer.from("delete").toString("base64") },
  ]);
  await store.deleteThreadMessages("thr_delete");
  await expect(fs.stat(persisted[0]!.path!)).rejects.toMatchObject({ code: "ENOENT" });
});

test("isManagedPath accepts paths under the store root regardless of separator style", async () => {
  const store = await createStore();
  const root = store.getRootDir();
  const forwardSlashPath = `${root.replaceAll("\\", "/")}/spool/thread_thr/img_1.png`;
  expect(store.isManagedPath(forwardSlashPath)).toBe(true);
});

test("isPromptImageAttachmentRecord accepts path-only attachments", () => {
  expect(
    isPromptImageAttachmentRecord({
      mediaType: "image/png",
      path: "/tmp/prompt-images/messages/thr/user/img.png",
    }),
  ).toBe(true);
  expect(isPromptImageAttachmentRecord({ mediaType: "image/png" })).toBe(false);
});
