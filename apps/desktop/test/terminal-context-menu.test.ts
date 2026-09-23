import { expect, test } from "bun:test";
import { createElement } from "react";
import { TerminalContextMenuPanel } from "../src/renderer/TerminalContextMenu";
import {
  TERMINAL_CONTEXT_MENU_Z_INDEX,
  terminalContextMenuBoxForPoint,
} from "../src/renderer/terminal-context-menu-layout";
import { renderLocalized } from "./i18n-test";

test("terminal context menu opens at the pointer", () => {
  const box = terminalContextMenuBoxForPoint(
    { x: 240, y: 160 },
    { height: 132 },
    {
      width: 1280,
      height: 800,
    },
  );
  expect(box).toEqual({
    position: "fixed",
    left: 240,
    top: 160,
    width: 188,
    zIndex: TERMINAL_CONTEXT_MENU_Z_INDEX,
  });
});

test("terminal context menu flips inside the viewport at the bottom-right edge", () => {
  const box = terminalContextMenuBoxForPoint(
    { x: 1276, y: 796 },
    { height: 132 },
    {
      width: 1280,
      height: 800,
    },
  );
  expect(box.left).toBe(1280 - 8 - 188);
  expect(box.top).toBe(800 - 8 - 132);
});

test("terminal context menu keeps the viewport margin at the top-left edge", () => {
  const box = terminalContextMenuBoxForPoint(
    { x: 1, y: 0 },
    { height: 132 },
    {
      width: 1280,
      height: 800,
    },
  );
  expect(box.left).toBe(8);
  expect(box.top).toBe(8);
});

test("terminal context menu lists copy, paste, and select-all", () => {
  const markup = renderLocalized(
    createElement(TerminalContextMenuPanel, {
      hasSelection: true,
      onCopy: () => undefined,
      onPaste: () => undefined,
      onSelectAll: () => undefined,
    }),
    "zh-CN",
  );
  expect(markup).toContain("terminal-context-menu-item");
  expect(markup).toContain("复制");
  expect(markup).toContain("粘贴");
  expect(markup).toContain("全选");
  expect(markup).not.toContain("disabled");
});

test("terminal context menu disables copy without a selection", () => {
  const markup = renderLocalized(
    createElement(TerminalContextMenuPanel, {
      hasSelection: false,
      onCopy: () => undefined,
      onPaste: () => undefined,
      onSelectAll: () => undefined,
    }),
    "en-US",
  );
  expect(markup).toContain("disabled");
  expect(markup).toContain("Copy");
  expect(markup).toContain("Paste");
  expect(markup).toContain("Select All");
});
