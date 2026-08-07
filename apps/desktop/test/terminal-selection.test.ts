import { describe, expect, test } from "bun:test";
import { computeSelectAllRange } from "../src/renderer/terminal-selection";

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
