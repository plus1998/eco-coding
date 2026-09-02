import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createWebChatListStore } from "../src/main/web-chat-list-store";
import { builtinWebChatItems } from "../src/shared/web-chat-list";

async function createTestDirectory(t: test.TestContext, prefix: string): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(async () => {
    await fs.rm(directory, { recursive: true, force: true });
  });
  return directory;
}

test("WebChatListStore merges builtins and persists custom bookmarks", async (t) => {
  const directory = await createTestDirectory(t, "eco-node-web-chat-list-");
  const dbPath = path.join(directory, "eco-coding.sqlite");
  const store = await createWebChatListStore(dbPath);

  const initial = store.get();
  assert.equal(initial.items.length, builtinWebChatItems().length);
  assert.ok(initial.items.every((item) => item.builtin));
  assert.ok(initial.items.some((item) => item.id === "chatgpt"));
  assert.ok(initial.items.some((item) => item.id === "deepseek"));

  const saved = store.save({
    customs: [
      {
        id: "c1",
        title: "My Bot",
        url: "https://my-bot.example",
        builtin: false,
        order: 10,
      },
    ],
  });
  assert.equal(saved.items.find((item) => item.id === "c1")?.title, "My Bot");
  assert.equal(saved.items.filter((item) => item.builtin).length, builtinWebChatItems().length);

  const reopened = await createWebChatListStore(dbPath);
  const again = reopened.get();
  assert.equal(again.items.find((item) => item.id === "c1")?.url, "https://my-bot.example");

  const cleared = reopened.save({ customs: [] });
  assert.equal(cleared.items.length, builtinWebChatItems().length, "clearing customs leaves builtins");
  assert.equal(
    cleared.items.some((item) => item.id === "c1"),
    false,
  );
});

test("WebChatListStore rejects builtin id collisions when saving customs", async (t) => {
  const directory = await createTestDirectory(t, "eco-node-web-chat-list-normalize-");
  const store = await createWebChatListStore(path.join(directory, "eco-coding.sqlite"));

  const saved = store.save({
    customs: [
      {
        id: "chatgpt",
        title: "Hijack",
        url: "https://evil.example",
        builtin: false,
        order: 1,
      },
      {
        id: "custom-ok",
        title: "OK",
        url: "https://ok.example",
        builtin: false,
        order: 2,
      },
    ],
  });

  assert.equal(saved.items.find((item) => item.id === "chatgpt")?.title, "ChatGPT");
  assert.equal(saved.items.find((item) => item.id === "chatgpt")?.url, "https://chatgpt.com");
  assert.equal(saved.items.find((item) => item.id === "custom-ok")?.title, "OK");
});
