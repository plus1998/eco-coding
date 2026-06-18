import { expect, test } from "bun:test";
import {
  externalPackageScriptTargetLabel,
  isExternalPackageScriptTarget,
  listPackageScriptRunTargets,
  normalizePackageScriptRunTarget,
} from "../src/shared/package-script-target";

test("isExternalPackageScriptTarget detects terminal targets", () => {
  expect(isExternalPackageScriptTarget("embedded")).toBe(false);
  expect(isExternalPackageScriptTarget("terminal")).toBe(true);
  expect(isExternalPackageScriptTarget("iterm")).toBe(true);
});

test("normalizePackageScriptRunTarget maps iterm to terminal off macOS", () => {
  expect(normalizePackageScriptRunTarget("iterm", "win32")).toBe("terminal");
  expect(normalizePackageScriptRunTarget("iterm", "linux")).toBe("terminal");
  expect(normalizePackageScriptRunTarget("iterm", "darwin")).toBe("iterm");
});

test("listPackageScriptRunTargets is platform aware", () => {
  expect(listPackageScriptRunTargets("darwin").map((entry) => entry.value)).toEqual([
    "embedded",
    "terminal",
    "iterm",
  ]);
  expect(listPackageScriptRunTargets("win32").map((entry) => entry.value)).toEqual(["embedded", "terminal"]);
  expect(listPackageScriptRunTargets("linux").map((entry) => entry.label)).toEqual(["应用内", "外部终端"]);
});

test("externalPackageScriptTargetLabel prefers launcher name", () => {
  expect(externalPackageScriptTargetLabel("terminal", "linux", "gnome-terminal")).toBe("gnome-terminal");
  expect(externalPackageScriptTargetLabel("terminal", "win32")).toBe("Windows Terminal");
});
