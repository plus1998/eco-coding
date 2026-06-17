import { expect, test } from "bun:test";
import { stripAnsi } from "../src/shared/strip-ansi";

test("stripAnsi removes SGR color codes", () => {
  const colored = "\u001B[41m\u001B[30m ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL \u001B[39m\u001B[49m";
  expect(stripAnsi(colored)).toBe(" ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL ");
});

test("stripAnsi removes red foreground codes", () => {
  const colored = "\u001B[31mpnpm\u001B[39m 执行失败";
  expect(stripAnsi(colored)).toBe("pnpm 执行失败");
});

test("stripAnsi leaves plain text unchanged", () => {
  expect(stripAnsi("hello world")).toBe("hello world");
});
