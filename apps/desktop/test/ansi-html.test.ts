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

test("ansiToHtml preserves output after terminal progress clear", () => {
  expect(ansiToHtml("Building...\rBuilding done\r\u001b[K")).toBe("Building...Building done");
  expect(ansiToHtml("error line\n\u001b[31mfailed\u001b[0m\r\u001b[K")).toBe(
    'error line\n<span class="ansi-fg-red">failed</span>',
  );
});

test("ansiToHtml renders 256-color foreground with inline style", () => {
  expect(ansiToHtml("\u001B[38;5;196mred256\u001B[0m normal")).toBe(
    '<span style="color: rgb(255, 0, 0)">red256</span> normal',
  );
});

test("ansiToHtml parses CSI introduced by ESC and C1", () => {
  expect(ansiToHtml("\u009b31mred\u001b[0m")).toBe('<span class="ansi-fg-red">red</span>');
});

test("ansiToHtml strips non-sgr control sequences", () => {
  expect(ansiToHtml("\u001B[Khello")).toBe("hello");
});

test("hasAnsi detects color sequences", () => {
  expect(hasAnsi("\u001B[31merror")).toBe(true);
  expect(hasAnsi("plain text")).toBe(false);
});
