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
  expect(primary).toContain('className="composer-attachment-preview"');

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

test("sent prompt images are clickable zoom targets", () => {
  const thumb = cssRule(".run-log-user-prompt-image");
  expect(thumb).toContain("cursor: zoom-in");
  expect(thumb).toContain("108px");
});

test("composer and edit attachments are clickable zoom targets", () => {
  const composer = cssRule(".composer-attachment-preview");
  const edit = cssRule(".run-log-user-prompt-edit-attachment-preview");
  expect(composer).toContain("cursor: zoom-in");
  expect(edit).toContain("cursor: zoom-in");
});
