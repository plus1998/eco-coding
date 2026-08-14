import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const appSource = readFileSync(fileURLToPath(new URL("../src/renderer/App.tsx", import.meta.url)), "utf8");
const styles = readFileSync(fileURLToPath(new URL("../src/renderer/styles.css", import.meta.url)), "utf8");

function cssRule(selector: string): string {
  const match = styles.match(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{[^}]*\\}`));
  return match?.[0] ?? "";
}

test("pasted composer images sit inside the composer card like mobile", () => {
  const primaryStart = appSource.indexOf('<div className="composer-primary">');
  const primaryEnd = appSource.indexOf('<div className="composer-footer">', primaryStart);
  const primary = appSource.slice(primaryStart, primaryEnd);
  expect(primaryStart).toBeGreaterThan(-1);
  expect(primary).toContain('className="composer-attachments"');

  const overlaysStart = appSource.indexOf('className="composer-input-overlays"');
  const overlays = appSource.slice(overlaysStart, primaryStart);
  expect(overlays).not.toContain("composer-attachments");
});

test("composer attachment chips match the mobile pending preview", () => {
  const strip = cssRule(".composer-attachments");
  const chip = cssRule(".composer-attachment");
  const remove = cssRule(".composer-attachment-remove");

  expect(strip).not.toContain("backdrop-filter");
  expect(strip).not.toContain("box-shadow");
  expect(strip).toContain("gap: 8px");
  expect(chip).toContain("width: 72px");
  expect(chip).toContain("height: 72px");
  expect(chip).toContain("border-radius: 12px");
  expect(remove).toContain("width: 24px");
  expect(remove).toContain("height: 24px");
});

test("sent prompt images match the mobile gallery size", () => {
  const images = cssRule(".run-log-user-prompt-images img");
  expect(images).toContain("108px");
  expect(images).toContain("border-radius: 10px");
});
