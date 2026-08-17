import { expect, test } from "bun:test";
import { createElement } from "react";
import { ComposerThreadUsagePills } from "../src/renderer/ComposerThreadUsagePills";
import { renderLocalized } from "./i18n-test";

const usageSummary = {
  billing: {
    plannerTokenCostUsd: 1,
    ecoCostUsd: 1,
    savedUsd: 0,
    savedPct: 0,
    pricingResolved: true,
    sourceReportedCostUsd: 1,
    totalTokens: { input: 10, output: 4, cacheRead: 0, cacheCreation: 0 },
  } as import("../src/shared/ipc").ThreadBillingSnapshot,
  context: {
    occupied: 12_000,
    limit: 200_000,
    occupancyPct: 6,
    limitsResolved: true,
    segments: [],
    updatedAt: Date.now(),
  },
};

test("hides composer usage pills when ACP host UI features are hide", () => {
  const markup = renderLocalized(
    createElement(ComposerThreadUsagePills, {
      threadId: "thr_cursor",
      threadStatus: "running",
      usageSummary,
      hostUiFeatures: { contextUsage: "hide", billing: "hide" },
    }),
    "zh-CN",
  );
  expect(markup).not.toContain("thread-info-float-stack");
  expect(markup).not.toContain("composer-usage-pills");
});

test("hides composer billing when the user preference is off", () => {
  const markup = renderLocalized(
    createElement(ComposerThreadUsagePills, {
      threadId: "thr_hidden_billing",
      threadStatus: "running",
      usageSummary: { billing: usageSummary.billing },
      showBilling: false,
    }),
    "zh-CN",
  );
  expect(markup).toContain("thread-info-float-stack");
  expect(markup).not.toContain("thread-info-float-pill-cost");
});

test("keeps composer usage pills for default show features", () => {
  const markup = renderLocalized(
    createElement(ComposerThreadUsagePills, {
      threadId: "thr_claude",
      threadStatus: "running",
      usageSummary,
    }),
    "zh-CN",
  );
  expect(markup).toContain("thread-info-float-stack");
  expect(markup).toContain("composer-usage-pills");
});
