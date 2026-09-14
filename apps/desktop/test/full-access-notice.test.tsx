import { expect, test } from "bun:test";
import { createElement } from "react";
import { FullAccessNotice } from "../src/renderer/FullAccessNotice";
import { renderLocalized } from "./i18n-test";

test("full access notice renders for allow-all mode", () => {
  const markup = renderLocalized(
    createElement(FullAccessNotice, {
      bashReviewMode: "allow_all",
      scopeKey: "thread-1",
    }),
    "en-US",
  );

  expect(markup).toContain("Full access is enabled");
  expect(markup).toContain("Don&#x27;t show again");
  expect(markup).toContain('role="alert"');
});

test("full access notice stays hidden for approval modes", () => {
  const markup = renderLocalized(
    createElement(FullAccessNotice, {
      bashReviewMode: "always",
      scopeKey: "thread-1",
    }),
    "en-US",
  );

  expect(markup).toBe("");
});
