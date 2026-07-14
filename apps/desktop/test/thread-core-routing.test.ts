import { expect, test } from "bun:test";
import { requireThreadCore } from "../src/main/thread-core-routing";

test("requireThreadCore accepts the matching runtime", () => {
  expect(() =>
    requireThreadCore({ id: "thr_claude", coreKind: "claude" }, "claude", "continue"),
  ).not.toThrow();
});

test("requireThreadCore rejects unknown ownership explicitly", () => {
  expect(() => requireThreadCore({ id: "thr_unknown" }, "claude", "continue")).toThrow(
    "CORE_MIGRATION_UNKNOWN",
  );
});

test("requireThreadCore rejects cross-Core routing explicitly", () => {
  expect(() => requireThreadCore({ id: "thr_codex", coreKind: "codex" }, "claude", "continue")).toThrow(
    "CORE_ROUTE_MISMATCH",
  );
});
