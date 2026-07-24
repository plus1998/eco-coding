import { expect, test } from "bun:test";
import { formatRelativeTime } from "../src/renderer/relative-time";

const now = Date.parse("2026-07-24T12:00:00.000Z");

test("relative time renders Chinese and English units", () => {
  expect(formatRelativeTime("2026-07-24T11:59:45.000Z", now, "zh-CN")).toBe("刚刚");
  expect(formatRelativeTime("2026-07-24T11:45:00.000Z", now, "zh-CN")).toBe("15 分钟");
  expect(formatRelativeTime("2026-07-24T10:00:00.000Z", now, "en-US")).toBe("2 hr");
  expect(formatRelativeTime("2026-07-14T12:00:00.000Z", now, "en-US")).toBe("1 wk");
});

test("relative time preserves invalid input behavior", () => {
  expect(formatRelativeTime("not-a-date", now, "en-US")).toBe("");
});
