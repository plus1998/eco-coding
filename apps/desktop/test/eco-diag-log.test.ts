import { expect, test } from "bun:test";
import { isEcoDiagLogEnabled, shortThreadId } from "../src/main/eco-diag-log";

test("shortThreadId trims thr_ prefix", () => {
  expect(shortThreadId("thr_1780505874581")).toBe("0505874581");
});

test("isEcoDiagLogEnabled respects ECO_DIAG_LOG=0", () => {
  const prev = process.env.ECO_DIAG_LOG;
  process.env.ECO_DIAG_LOG = "0";
  expect(isEcoDiagLogEnabled()).toBe(false);
  process.env.ECO_DIAG_LOG = prev;
});
