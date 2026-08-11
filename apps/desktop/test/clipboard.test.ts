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
