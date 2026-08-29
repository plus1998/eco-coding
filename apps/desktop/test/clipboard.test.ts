import { expect, test } from "bun:test";
import { copyTextToClipboard } from "../src/renderer/clipboard";

test("copyTextToClipboard returns false for empty text", async () => {
  expect(await copyTextToClipboard("")).toBe(false);
});

test("copyTextToClipboard writes via clipboard API when available", async () => {
  const writes: string[] = [];
  const original = navigator.clipboard;
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: async (text: string) => {
        writes.push(text);
      },
    },
  });
  try {
    expect(await copyTextToClipboard("hello")).toBe(true);
    expect(writes).toEqual(["hello"]);
  } finally {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: original,
    });
  }
});

test("copyTextToClipboard falls back when clipboard API rejects", async () => {
  const originalClipboard = navigator.clipboard;
  const originalDocument = globalThis.document;
  const execCommand = () => true;
  const area = {
    value: "",
    setAttribute: () => undefined,
    style: {} as CSSStyleDeclaration,
    select: () => undefined,
  };
  const stubDocument = {
    createElement: () => area,
    body: {
      appendChild: () => area,
      removeChild: () => area,
    },
    execCommand,
  } as unknown as Document;
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: async () => {
        throw new Error("NotAllowedError");
      },
    },
  });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: stubDocument,
  });
  try {
    expect(await copyTextToClipboard("fallback")).toBe(true);
  } finally {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: originalClipboard,
    });
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: originalDocument,
    });
  }
});

test("copyHtmlToClipboard writes html and plain payloads", async () => {
  const { copyHtmlToClipboard } = await import("../src/renderer/clipboard");
  const items: unknown[] = [];
  const original = navigator.clipboard;
  const OriginalClipboardItem = globalThis.ClipboardItem;
  class FakeClipboardItem {
    constructor(public readonly items: Record<string, Blob>) {}
  }
  Object.defineProperty(globalThis, "ClipboardItem", {
    configurable: true,
    value: FakeClipboardItem,
  });
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      write: async (next: unknown[]) => {
        items.push(...next);
      },
    },
  });
  try {
    expect(await copyHtmlToClipboard("<table></table>", "| a |")).toBe(true);
    expect(items).toHaveLength(1);
  } finally {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: original,
    });
    Object.defineProperty(globalThis, "ClipboardItem", {
      configurable: true,
      value: OriginalClipboardItem,
    });
  }
});
