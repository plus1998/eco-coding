import { expect, test } from "bun:test";
import { buildRedisConnectionUrl, ECO_SERVER_REDIS_URL } from "../src/presence/presence-store";

test("buildRedisConnectionUrl uses fixed redis endpoint", () => {
  expect(buildRedisConnectionUrl()).toBe(ECO_SERVER_REDIS_URL);
  expect(buildRedisConnectionUrl("   ")).toBe(ECO_SERVER_REDIS_URL);
});

test("buildRedisConnectionUrl injects password", () => {
  expect(buildRedisConnectionUrl("secret")).toBe("redis://:secret@127.0.0.1:6379");
});
