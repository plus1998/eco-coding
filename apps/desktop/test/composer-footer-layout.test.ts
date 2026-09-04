import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const appSource = readFileSync(fileURLToPath(new URL("../src/renderer/App.tsx", import.meta.url)), "utf8");
const styles = readFileSync(fileURLToPath(new URL("../src/renderer/styles.css", import.meta.url)), "utf8");
const tooltipSource = readFileSync(
  fileURLToPath(new URL("../src/renderer/ComposerHoverTooltip.tsx", import.meta.url)),
  "utf8",
);

function composerFooterSource(): string {
  const footerStart = appSource.indexOf('<div className="composer-footer">');
  const actionsStart = appSource.indexOf('className="composer-footer-actions"', footerStart);
  const footerEnd = appSource.indexOf("</div>", appSource.lastIndexOf("composerActionClassName"));
  return appSource.slice(footerStart, footerEnd);
}

test("composer footer keeps left config and right actions in one row", () => {
  const footer = composerFooterSource();
  expect(footer).toContain("composer-footer-config-row");
  expect(footer).toContain("composer-footer-spacer");
  expect(footer).toContain("composer-footer-actions");
  expect(footer).toContain("ComposerBashReviewToggle");
  expect(footer).toContain("composerActionClassName");
  expect(footer.indexOf("composer-footer-config-row")).toBeLessThan(
    footer.indexOf("composer-footer-actions"),
  );
  expect(footer.indexOf("composer-footer-actions")).toBeLessThan(footer.indexOf("composerActionClassName"));
});

test("narrow composer does not wrap the config row or hide the spacer", () => {
  expect(styles).not.toMatch(/composer-footer-config-row[^{]*\{[^}]*flex:\s*0\s+0\s+100%/);
  expect(styles).not.toMatch(/\.composer-footer-spacer\s*\{\s*display:\s*none/);
});

test("composer usage pills stay on one line under squeeze", () => {
  expect(styles).toMatch(/\.composer-footer-usage\s*\{[^}]*flex:\s*0\s+0\s+auto/s);
  expect(styles).toMatch(/\.composer-usage-pills\s*\{[^}]*flex-wrap:\s*nowrap/s);
  expect(styles).toMatch(/\.composer-model-selector\s*\{[^}]*flex:\s*0\s+1\s+auto/s);
});

test("composer toolbar container is the card shared by landing and thread", () => {
  expect(styles).toContain("container-name: composer-toolbar");
  expect(styles).toContain("@container composer-toolbar (max-width: 640px)");
  expect(tooltipSource).toContain('COMPOSER_ICON_ONLY_CONTAINER = ".codex-composer-wrap"');
  expect(tooltipSource).not.toContain(":not(.codex-main-landing)");
});

test("send cluster stays on the trailing edge", () => {
  expect(styles).toMatch(/\.composer-footer-actions\s*\{[^}]*margin-left:\s*auto/s);
  expect(styles).toMatch(/\.composer-footer\s*\{[^}]*flex-wrap:\s*nowrap/s);
});
