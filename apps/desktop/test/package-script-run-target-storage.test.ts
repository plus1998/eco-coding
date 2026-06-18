import { expect, test } from "bun:test";
import {
  readPackageScriptRunTarget,
  savePackageScriptRunTarget,
} from "../src/renderer/package-script-run-target-storage";

test("package script run target defaults to embedded", () => {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.clear();
  expect(readPackageScriptRunTarget()).toBe("embedded");
});

test("package script run target persists valid values", () => {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.clear();
  savePackageScriptRunTarget("iterm");
  expect(readPackageScriptRunTarget()).toBe("iterm");
});

test("package script run target ignores invalid stored values", () => {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.clear();
  window.localStorage.setItem("eco.package-script-run-target", "invalid");
  expect(readPackageScriptRunTarget()).toBe("embedded");
});
