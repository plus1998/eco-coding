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
