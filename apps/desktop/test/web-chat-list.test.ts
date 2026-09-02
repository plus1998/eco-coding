import { expect, test } from "bun:test";
import {
  builtinWebChatItems,
  createCustomWebChatItem,
  defaultWebChatListSnapshot,
  isWebChatListSnapshot,
  mergeWebChatList,
  normalizeWebChatListSnapshot,
  normalizeWebChatUrl,
  removeCustomWebChatItem,
  webChatHostname,
} from "../src/shared/web-chat-list";

test("builtinWebChatItems includes ChatGPT and DeepSeek", () => {
  const items = builtinWebChatItems();
  expect(items.length).toBeGreaterThanOrEqual(6);
  expect(items.every((item) => item.builtin)).toBe(true);
  expect(items.find((item) => item.id === "chatgpt")?.url).toBe("https://chatgpt.com");
  expect(items.find((item) => item.id === "deepseek")?.url).toBe("https://chat.deepseek.com");
});

test("normalizeWebChatUrl accepts bare hosts and rejects junk", () => {
  expect(normalizeWebChatUrl("chatgpt.com")).toBe("https://chatgpt.com");
  expect(normalizeWebChatUrl("https://chat.deepseek.com/")).toBe("https://chat.deepseek.com/");
  expect(normalizeWebChatUrl("")).toBeUndefined();
  expect(normalizeWebChatUrl("not a url")).toBeUndefined();
  expect(normalizeWebChatUrl("tool.started")).toBeUndefined();
});

test("normalizeWebChatListSnapshot keeps only valid customs and drops builtin id collisions", () => {
  const snapshot = normalizeWebChatListSnapshot({
    customs: [
      { id: "custom-1", title: "Grok", url: "https://grok.com", builtin: false, order: 10 },
      { id: "chatgpt", title: "Fake", url: "https://example.com", builtin: false, order: 1 },
      { id: "bad", title: "", url: "https://x.com", builtin: false, order: 2 },
      { id: "custom-1", title: "Dup", url: "https://other.com", builtin: false, order: 11 },
    ],
  });
  expect(snapshot.customs).toEqual([
    {
      id: "custom-1",
      title: "Grok",
      url: "https://grok.com",
      builtin: false,
      order: 10,
    },
  ]);
});

test("isWebChatListSnapshot validates customs only", () => {
  expect(isWebChatListSnapshot(defaultWebChatListSnapshot())).toBe(true);
  expect(
    isWebChatListSnapshot({
      customs: [{ id: "c1", title: "A", url: "https://a.example", builtin: false, order: 0 }],
    }),
  ).toBe(true);
  expect(isWebChatListSnapshot({ customs: [{ id: "chatgpt", title: "X", url: "https://x.com" }] })).toBe(
    false,
  );
  expect(isWebChatListSnapshot({ customs: "nope" })).toBe(false);
  expect(isWebChatListSnapshot(null)).toBe(false);
});

test("mergeWebChatList appends customs after builtins", () => {
  const view = mergeWebChatList({
    customs: [
      {
        id: "c1",
        title: "Custom",
        url: "https://custom.example",
        builtin: false,
        order: 99,
      },
    ],
  });
  expect(view.items[0]?.id).toBe("chatgpt");
  expect(view.items.at(-1)).toMatchObject({
    id: "c1",
    title: "Custom",
    builtin: false,
  });
  expect(view.items.filter((item) => item.builtin).length).toBe(builtinWebChatItems().length);
});

test("createCustomWebChatItem and removeCustomWebChatItem", () => {
  const empty = defaultWebChatListSnapshot();
  const created = createCustomWebChatItem({ title: " Grok ", url: "grok.x.ai" }, empty, () => "fixed-id");
  expect(created.ok).toBe(true);
  if (!created.ok) {
    return;
  }
  expect(created.item).toEqual({
    id: "fixed-id",
    title: "Grok",
    url: "https://grok.x.ai",
    builtin: false,
    order: expect.any(Number) as number,
  });
  expect(created.next.customs).toHaveLength(1);

  const dup = createCustomWebChatItem({ title: "Again", url: "https://grok.x.ai" }, created.next);
  expect(dup.ok).toBe(false);
  if (dup.ok) {
    return;
  }
  expect(dup.reason).toBe("duplicate_url");

  const invalidTitle = createCustomWebChatItem({ title: "  ", url: "https://ok.com" }, empty);
  expect(invalidTitle.ok).toBe(false);

  const removed = removeCustomWebChatItem("fixed-id", created.next);
  expect(removed.customs).toEqual([]);
});

test("webChatHostname strips www", () => {
  expect(webChatHostname("https://www.perplexity.ai/path")).toBe("perplexity.ai");
  expect(webChatHostname("https://chat.deepseek.com")).toBe("chat.deepseek.com");
});

test("webChatListPopoverBoxForRect places panel below and right-aligned", async () => {
  const { webChatListPopoverBoxForRect } = await import("../src/renderer/web-chat-list-popover-layout");
  const style = webChatListPopoverBoxForRect(
    { top: 12, bottom: 40, left: 900, right: 928, width: 28, height: 28 },
    { width: 1200, height: 800 },
  );
  expect(style.position).toBe("fixed");
  expect(style.top).toBe(46); // 40 + 6 gap
  expect(style.left).toBe(628); // 928 - 300
  expect(style.width).toBe(300);
  expect(style.visibility).toBe("visible");
  expect(style.zIndex).toBeGreaterThan(1_000_000);
});
