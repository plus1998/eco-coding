import { expect, test } from "bun:test";
import { createElement } from "react";
import { ThreadIdleCacheWarning } from "../src/renderer/ThreadIdleCacheWarning";
import { renderLocalized } from "./i18n-test";

test("idle cache warning exposes text-only primary and dismiss actions", () => {
  const markup = renderLocalized(
    createElement(ThreadIdleCacheWarning, {
      lastActivityAt: new Date(Date.now() - 60 * 60_000).toISOString(),
      onStartNewThread: () => undefined,
    }),
    "en-US",
  );

  expect(markup).toContain("The cache may have expired");
  expect(markup).toContain(">New thread</button>");
  expect(markup).toContain('aria-label="Dismiss cache notice"');
  expect(markup).not.toContain("feed-notice-action-icon");
});
