import { expect, test } from "bun:test";
import { isReloadShortcutInput } from "../src/main/packaged-window-shortcuts";

test("blocks reload keydown shortcuts in packaged windows", () => {
  expect(isReloadShortcutInput({ type: "keyDown", key: "r", control: true, meta: false })).toBe(true);
  expect(isReloadShortcutInput({ type: "keyDown", key: "R", control: false, meta: true })).toBe(true);
  const forceReloadInput = {
    type: "keyDown",
    key: "r",
    control: true,
    meta: false,
    shift: true,
  };
  expect(isReloadShortcutInput(forceReloadInput)).toBe(true);
});

test("does not block unrelated input events", () => {
  expect(isReloadShortcutInput({ type: "keyDown", key: "r", control: false, meta: false })).toBe(false);
  expect(isReloadShortcutInput({ type: "keyDown", key: "t", control: true, meta: false })).toBe(false);
  expect(isReloadShortcutInput({ type: "keyUp", key: "r", control: true, meta: false })).toBe(false);
});
