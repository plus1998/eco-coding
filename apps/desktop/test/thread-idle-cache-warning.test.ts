import { expect, test } from "bun:test";
import {
  resolveLatestThreadActivityAt,
  resolveThreadIdleDuration,
  THREAD_IDLE_CACHE_WARNING_THRESHOLD_MS,
} from "../src/renderer/thread-idle-cache-warning";

const BASE_TIME = Date.parse("2026-08-09T12:00:00.000Z");

test("uses the latest valid conversation timeline timestamp", () => {
  expect(
    resolveLatestThreadActivityAt([
      { at: new Date(BASE_TIME + 90_000).toISOString() },
      { at: "not-a-date" },
      { at: new Date(BASE_TIME).toISOString() },
    ]),
  ).toBe(new Date(BASE_TIME + 90_000).toISOString());
});

test("does not invent activity when the timeline has no valid timestamps", () => {
  expect(resolveLatestThreadActivityAt([{ at: "not-a-date" }])).toBeUndefined();
});

test("does not warn before the idle threshold", () => {
  const updatedAt = new Date(BASE_TIME).toISOString();
  expect(
    resolveThreadIdleDuration(
      updatedAt,
      BASE_TIME + THREAD_IDLE_CACHE_WARNING_THRESHOLD_MS - 1,
    ),
  ).toBeUndefined();
});

test("returns minute-level idle duration at the threshold", () => {
  const updatedAt = new Date(BASE_TIME).toISOString();
  const duration = resolveThreadIdleDuration(
    updatedAt,
    BASE_TIME + THREAD_IDLE_CACHE_WARNING_THRESHOLD_MS,
  );

  expect(duration).toEqual({
    idleMs: THREAD_IDLE_CACHE_WARNING_THRESHOLD_MS,
    totalMinutes: 30,
    hours: 0,
    minutes: 30,
  });
});

test("splits longer idle periods into hours and minutes", () => {
  const updatedAt = new Date(BASE_TIME).toISOString();
  const duration = resolveThreadIdleDuration(updatedAt, BASE_TIME + 90 * 60_000 + 42_000);

  expect(duration?.totalMinutes).toBe(90);
  expect(duration?.hours).toBe(1);
  expect(duration?.minutes).toBe(30);
});

test("ignores invalid and future timestamps", () => {
  expect(resolveThreadIdleDuration("not-a-date", BASE_TIME + 60 * 60_000)).toBeUndefined();
  expect(resolveThreadIdleDuration(new Date(BASE_TIME + 1_000).toISOString(), BASE_TIME)).toBeUndefined();
});
