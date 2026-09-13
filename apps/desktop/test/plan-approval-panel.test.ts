import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { MAIN_SHELL_BREAKPOINTS } from "../src/renderer/activity-workspace-layout";
import { i18nCatalogs } from "../src/shared/i18n-catalogs";

const panelSource = readFileSync(
  fileURLToPath(new URL("../src/renderer/PlanApprovalPanel.tsx", import.meta.url)),
  "utf8",
);
const styles = readFileSync(fileURLToPath(new URL("../src/renderer/styles.css", import.meta.url)), "utf8");

test("docked plan approval can expand in place on the narrow overlay breakpoint", () => {
  expect(panelSource).toContain('className="plan-approval-expand"');
  expect(panelSource).toContain("aria-expanded={expanded}");
  expect(panelSource).toContain('expanded ? "is-expanded" : ""');
  expect(panelSource).toContain("MAIN_SHELL_MEDIA_QUERIES.taskOverlay");
  expect(panelSource).toContain("setExpanded(false)");

  expect(styles).toContain(".plan-approval-expand");
  expect(styles).toContain(".plan-approval-dock-shell.is-expanded .plan-approval-dock-markdown");
  expect(styles).toContain("min(85dvh, calc(100dvh - var(--workspace-toolbar-clearance, 36px) - 20px))");
  expect(styles).toMatch(
    new RegExp(
      `@media \\(max-width: ${MAIN_SHELL_BREAKPOINTS.taskOverlay}px\\) \\{[\\s\\S]*?\\.plan-approval-expand \\{[\\s\\S]*?display:\\s*inline-flex;[\\s\\S]*?\\.plan-approval-open-panel \\{[\\s\\S]*?display:\\s*none;`,
    ),
  );
});

test("plan expand copy exists in both catalogs", () => {
  expect(i18nCatalogs["zh-CN"].translation["approval.plan.expand"]).toBe("展开计划");
  expect(i18nCatalogs["zh-CN"].translation["approval.plan.collapse"]).toBe("收起计划");
  expect(i18nCatalogs["en-US"].translation["approval.plan.expand"]).toBe("Expand plan");
  expect(i18nCatalogs["en-US"].translation["approval.plan.collapse"]).toBe("Collapse plan");
});

test("plan approval keeps the execute button visible after a failure (retry)", () => {
  // The execute action must not be hidden behind a failure conditional, otherwise a
  // failed forced-delegation run could never be retried from the card.
  expect(panelSource).not.toContain("{!failureMessage ? (");
  expect(panelSource).toContain('className={docked ? "bash-approval-submit" : "plan-button primary"}');
});

test("plan approval exposes the subagent delegation split button and popover", () => {
  expect(panelSource).toContain("onApproveWithSubagent");
  expect(panelSource).toContain('className="plan-approval-execute-split"');
  expect(panelSource).toContain("plan-approval-delegate-toggle");
  expect(panelSource).toContain("plan-approval-delegation-popover");
  expect(panelSource).toContain("plan-approval-delegation-agent");

  expect(styles).toContain(".plan-approval-execute-split");
  expect(styles).toContain(".plan-approval-delegation-popover");
  expect(styles).toContain(".plan-approval-delegation-agent.is-focused");
});

test("delegation UI copy exists in both catalogs", () => {
  for (const locale of ["zh-CN", "en-US"] as const) {
    expect(i18nCatalogs[locale].translation["approval.plan.delegateAria"]).toBeTruthy();
    expect(i18nCatalogs[locale].translation["approval.plan.delegateTitle"]).toBeTruthy();
    expect(i18nCatalogs[locale].translation["approval.plan.delegateMessageLabel"]).toBeTruthy();
    expect(i18nCatalogs[locale].translation["approval.plan.delegateMessagePlaceholder"]).toBeTruthy();
  }
});

test("plan approval never offers read-only subagents as an executable target", () => {
  // Explore cannot write the workspace, so delegating a plan to it always fails.
  expect(panelSource).toContain("agent.canExecutePlan");
  expect(panelSource).toContain("plan-approval-delegation-agent-note");
  expect(styles).toContain(".plan-approval-delegation-agent.is-read-only");
  for (const locale of ["zh-CN", "en-US"] as const) {
    expect(i18nCatalogs[locale].translation["approval.plan.delegateReadOnly"]).toBeTruthy();
  }
});
