import { expect, test } from "bun:test";
import { buildRateLimitKey, MemoryRateLimiter } from "../src/rate-limit";

test("memory rate limiter blocks requests beyond the configured window limit", async () => {
  const limiter = new MemoryRateLimiter();
  const rule = { limit: 2, windowSeconds: 60 };
  const now = new Date("2026-01-01T00:00:00.000Z");

  expect((await limiter.consume({ key: "auth:one", rule, now })).allowed).toBe(true);
  expect((await limiter.consume({ key: "auth:one", rule, now })).allowed).toBe(true);

  const denied = await limiter.consume({ key: "auth:one", rule, now });
  expect(denied.allowed).toBe(false);
  expect(denied.retryAfterSeconds).toBe(60);

  const afterWindow = await limiter.consume({
    key: "auth:one",
    rule,
    now: new Date("2026-01-01T00:01:00.000Z"),
  });
  expect(afterWindow.allowed).toBe(true);
});

test("rate limit keys hash subject parts instead of exposing raw values", async () => {
  const key = await buildRateLimitKey("auth.login", ["203.0.113.1", "owner@example.com"]);

  expect(key.startsWith("auth.login:")).toBe(true);
  expect(key).not.toContain("owner@example.com");
  expect(key).not.toContain("203.0.113.1");
});
