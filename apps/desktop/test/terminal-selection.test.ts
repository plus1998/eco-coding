import { describe, expect, test } from "bun:test";
import type { Terminal as GhosttyTerminalType } from "ghostty-web";
import {
  computeSelectAllRange,
  installTerminalSelectionEnhancements,
  pasteClipboardIntoTerminal,
} from "../src/renderer/terminal-selection";

interface StubSelectionManager {
  selectionStart: { col: number; absoluteRow: number } | null;
  selectionEnd: { col: number; absoluteRow: number } | null;
  isSelecting: boolean;
  copied: string[];
  selectAllCalls: number;
  hasSelection(): boolean;
  getSelection(): string;
  clearSelection(): void;
  selectAll(): void;
  pixelToCell(x: number, y: number): { col: number; row: number };
  viewportRowToAbsolute(row: number): number;
  markCurrentSelectionDirty(): void;
  requestRender(): void;
  copyToClipboard(text: string): Promise<void>;
  selectionChangedEmitter: { fire: () => void };
}

function createStubTerminal(): { terminal: GhosttyTerminalType; manager: StubSelectionManager } {
  const manager: StubSelectionManager = {
    selectionStart: null,
    selectionEnd: null,
    isSelecting: false,
    copied: [],
    selectAllCalls: 0,
    hasSelection: () => false,
    getSelection: () => "",
    clearSelection: () => undefined,
    selectAll: () => {
      manager.selectAllCalls += 1;
    },
    pixelToCell: () => ({ col: 0, row: 0 }),
    viewportRowToAbsolute: (row) => row,
    markCurrentSelectionDirty: () => undefined,
    requestRender: () => undefined,
    copyToClipboard: async (text: string) => {
      manager.copied.push(text);
    },
    selectionChangedEmitter: { fire: () => undefined },
  };
  const canvas = {
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  };
  const terminal = {
    cols: 80,
    buffer: { active: { length: 24 } },
    selectAll: () => undefined,
    selectionManager: manager,
    canvas,
  } as unknown as GhosttyTerminalType;
  return { terminal, manager };
}

describe("computeSelectAllRange", () => {
  test("covers the full buffer from origin to last cell", () => {
    expect(computeSelectAllRange(120, 40)).toEqual({
      start: { col: 0, absoluteRow: 0 },
      end: { col: 119, absoluteRow: 39 },
    });
  });

  test("returns null for invalid dimensions", () => {
    expect(computeSelectAllRange(0, 10)).toBeNull();
    expect(computeSelectAllRange(80, 0)).toBeNull();
    expect(computeSelectAllRange(-1, 5)).toBeNull();
  });
});

describe("installTerminalSelectionEnhancements", () => {
  test("silences the library's copy-on-selection-end clipboard write", async () => {
    const { terminal, manager } = createStubTerminal();
    const uninstall = installTerminalSelectionEnhancements(terminal);

    await manager.copyToClipboard("selected text");
    expect(manager.copied).toEqual([]);

    uninstall();
  });

  test("restores the library clipboard write on uninstall", async () => {
    const { terminal, manager } = createStubTerminal();
    installTerminalSelectionEnhancements(terminal)();

    await manager.copyToClipboard("selected text");
    expect(manager.copied).toEqual(["selected text"]);
  });

  test("routes manager.selectAll through the full-buffer selection", () => {
    const { terminal, manager } = createStubTerminal();
    const uninstall = installTerminalSelectionEnhancements(terminal);

    manager.selectAll();
    expect(manager.selectAllCalls).toBe(0);
    expect(manager.selectionStart).toEqual({ col: 0, absoluteRow: 0 });
    expect(manager.selectionEnd).toEqual({ col: 79, absoluteRow: 23 });

    uninstall();
    manager.selectAll();
    expect(manager.selectAllCalls).toBe(1);
  });
});

describe("pasteClipboardIntoTerminal", () => {
  test("pastes clipboard text through the terminal (bracketed paste aware)", async () => {
    const pasted: string[] = [];
    const terminal = { paste: (text: string) => pasted.push(text) } as unknown as GhosttyTerminalType;

    const ok = await pasteClipboardIntoTerminal(terminal, async () => "echo hi");

    expect(ok).toBe(true);
    expect(pasted).toEqual(["echo hi"]);
  });

  test("does not touch the terminal when the clipboard is empty", async () => {
    const pasted: string[] = [];
    const terminal = { paste: (text: string) => pasted.push(text) } as unknown as GhosttyTerminalType;

    const ok = await pasteClipboardIntoTerminal(terminal, async () => "");

    expect(ok).toBe(false);
    expect(pasted).toEqual([]);
  });
});
