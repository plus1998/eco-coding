import { expect, test } from "bun:test";
import {
  resolvePacedRevealCount,
  revealPacedText,
  splitStreamingTextUnits,
} from "../src/renderer/use-paced-stream-text";

test("splitStreamingTextUnits keeps grapheme clusters intact", () => {
  expect(splitStreamingTextUnits("你👍🏽e\u0301好")).toEqual(["你", "👍🏽", "e\u0301", "好"]);
});

test("revealPacedText reveals a small live backlog one grapheme at a time", () => {
  expect(revealPacedText("开始", "开始输出👍🏽", true)).toBe("开始输");
});

test("resolvePacedRevealCount accelerates as the live backlog grows", () => {
  expect(resolvePacedRevealCount(12, true)).toBe(1);
  expect(resolvePacedRevealCount(30, true)).toBe(2);
  expect(resolvePacedRevealCount(80, true)).toBe(4);
  expect(resolvePacedRevealCount(140, true)).toBe(8);
});

test("revealPacedText still can drain when streaming is false (hook snaps instead)", () => {
  expect(resolvePacedRevealCount(6, false)).toBe(4);
  expect(revealPacedText("开", "开始输出", false)).toBe("开始输出");
});

test("revealPacedText applies non-append replacements immediately", () => {
  expect(revealPacedText("旧输出", "新输出", true)).toBe("新输出");
});
