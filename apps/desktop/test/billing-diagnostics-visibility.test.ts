import { expect, test } from "bun:test";
import { filterVisibleBillingDiagnostics } from "../src/shared/billing-diagnostics-visibility";
import type { ThreadBillingDiagnostic } from "../src/shared/ipc";

const tokenMismatch: ThreadBillingDiagnostic = {
  type: "token_mismatch",
  severity: "error",
  field: "input",
  delta: -85346,
  message: "计费 token 校验不一致：input 相差 -85346。",
};

const costMismatch: ThreadBillingDiagnostic = {
  type: "cost_mismatch",
  severity: "error",
  field: "ecoCostUsd",
  delta: -0.012415,
  message: "计费成本校验不一致：ecoCostUsd 相差 $-0.012415。",
};

const pricingUnresolved: ThreadBillingDiagnostic = {
  type: "pricing_unresolved",
  severity: "warning",
  message: "部分模型未匹配 models.dev 单价，成本估算可能不完整。",
};

test("filterVisibleBillingDiagnostics hides deferred reconciliation drift while running", () => {
  expect(
    filterVisibleBillingDiagnostics([tokenMismatch, costMismatch, pricingUnresolved], "running"),
  ).toEqual([pricingUnresolved]);
  expect(filterVisibleBillingDiagnostics([tokenMismatch, pricingUnresolved], "queued")).toEqual([
    pricingUnresolved,
  ]);
});

test("filterVisibleBillingDiagnostics shows reconciliation drift after the run settles", () => {
  expect(filterVisibleBillingDiagnostics([tokenMismatch, costMismatch], "completed")).toEqual([
    tokenMismatch,
    costMismatch,
  ]);
  expect(filterVisibleBillingDiagnostics([tokenMismatch], "failed")).toEqual([tokenMismatch]);
});
