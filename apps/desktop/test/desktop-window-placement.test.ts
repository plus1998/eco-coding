import { describe, expect, test } from "bun:test";
import { centerBoundsInWorkArea } from "../src/main/desktop-window-bounds";

describe("centerBoundsInWorkArea", () => {
  test("centers on a primary display work area", () => {
    expect(centerBoundsInWorkArea({ x: 0, y: 0, width: 1920, height: 1080 }, 1320, 860)).toEqual({
      x: 300,
      y: 110,
      width: 1320,
      height: 860,
    });
  });

  test("centers on a left secondary display with negative coordinates", () => {
    expect(centerBoundsInWorkArea({ x: -1920, y: 0, width: 1920, height: 1080 }, 1320, 860)).toEqual({
      x: -1620,
      y: 110,
      width: 1320,
      height: 860,
    });
  });

  test("clamps window size when larger than the work area", () => {
    expect(centerBoundsInWorkArea({ x: 0, y: 0, width: 800, height: 600 }, 1320, 860)).toEqual({
      x: 0,
      y: 0,
      width: 800,
      height: 600,
    });
  });

  test("centers clamped window within offset work area", () => {
    expect(centerBoundsInWorkArea({ x: 100, y: 50, width: 800, height: 600 }, 1320, 860)).toEqual({
      x: 100,
      y: 50,
      width: 800,
      height: 600,
    });
  });
});
