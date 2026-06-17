import { expect, test } from "bun:test";
import { ansiToHtml, hasAnsi } from "../src/shared/ansi-html";

test("ansiToHtml renders pnpm error colors", () => {
  const colored =
    "\u001B[41m\u001B[30m ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL \u001B[39m\u001B[49m";
  expect(ansiToHtml(colored)).toBe(
    '<span class="ansi-fg-black ansi-bg-red"> ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL </span>',
  );
});

test("ansiToHtml renders red foreground text", () => {
  const colored = "\u001B[31mpnpm\u001B[39m 执行失败";
  expect(ansiToHtml(colored)).toBe(
    '<span class="ansi-fg-red">pnpm</span> 执行失败',
  );
});

test("ansiToHtml escapes html in plain text", () => {
  expect(ansiToHtml("<script>&")).toBe("&lt;script&gt;&amp;");
});

test("ansiToHtml keeps the latest carriage-return line", () => {
  expect(ansiToHtml("loading 10%\rloading 50%\rloading 100%\n")).toBe("loading 100%\n");
});

test("ansiToHtml strips non-sgr control sequences", () => {
  expect(ansiToHtml("\u001B[Khello")).toBe("hello");
});

test("hasAnsi detects color sequences", () => {
  expect(hasAnsi("\u001B[31merror")).toBe(true);
  expect(hasAnsi("plain text")).toBe(false);
});
