import { expect, test } from "bun:test";
import {
  evaluateCompactSummaryQuality,
  extractFilePathsForGrounding,
  looksLikeFilePath,
} from "../src/shared/compact-summary-quality";

interface GoldenCase {
  id: string;
  expectedOk: boolean;
  summary: string;
  sourceTexts?: readonly string[];
  requiredFacts?: Parameters<typeof evaluateCompactSummaryQuality>[1] extends infer S
    ? S extends { requiredFacts?: infer R }
      ? R
      : never
    : never;
  forbiddenClaims?: readonly string[];
}

const fixturePath = new URL("./fixtures/compact-summary-golden.json", import.meta.url);
const goldenCases = (await Bun.file(fixturePath).json()) as GoldenCase[];

for (const fixture of goldenCases) {
  test(`compact summary golden: ${fixture.id}`, () => {
    const report = evaluateCompactSummaryQuality(fixture.summary, {
      sourceTexts: fixture.sourceTexts,
      requiredFacts: fixture.requiredFacts,
      forbiddenClaims: fixture.forbiddenClaims,
      checkGrounding: true,
    });
    expect(report.ok, JSON.stringify(report.issues, null, 2)).toBe(fixture.expectedOk);
  });
}

test("quality gate rejects unsupported file paths", () => {
  const report = evaluateCompactSummaryQuality(
    "Fixed apps/desktop/src/main/invented.ts and continued investigation.",
    { sourceTexts: ["只检查了 apps/desktop/src/main/index.ts"], checkGrounding: true },
  );
  expect(report.issues.map((issue) => issue.code)).toContain("unsupported_file_path");
});

test("path extraction ignores dates and thin a/b fragments", () => {
  expect(looksLikeFilePath("2024/01/02")).toBe(false);
  expect(looksLikeFilePath("a/b")).toBe(false);
  expect(looksLikeFilePath("v1/v2")).toBe(false);
  expect(looksLikeFilePath("apps/desktop/src/main/index.ts")).toBe(true);
  expect(looksLikeFilePath("src/v2/handler.ts")).toBe(true);

  const extracted = extractFilePathsForGrounding(
    "Shipped on 2024/01/02; compare a/b vs apps/desktop/src/main/index.ts:12.",
  );
  expect(extracted.some((path) => path.includes("index.ts"))).toBe(true);
  expect(extracted.some((path) => /2024/.test(path))).toBe(false);
  expect(extracted.some((path) => path === "a/b" || path.endsWith("/a/b"))).toBe(false);
});

test("dates in summary do not trigger unsupported_file_path grounding", () => {
  const report = evaluateCompactSummaryQuality("Meeting notes for 2024/01/02 and ratio a/b remain open.", {
    sourceTexts: ["no files mentioned"],
    checkGrounding: true,
  });
  expect(report.issues.map((issue) => issue.code)).not.toContain("unsupported_file_path");
  expect(report.ok).toBe(true);
});

test("empty summary fails", () => {
  const report = evaluateCompactSummaryQuality("");
  expect(report.ok).toBe(false);
  expect(report.issues.map((issue) => issue.code)).toContain("empty_summary");
});

test("free-form Codex handoff passes when non-empty", () => {
  const report = evaluateCompactSummaryQuality(
    "Progress: wired handoff. Next: write tests. Constraints: fail closed.",
  );
  expect(report.ok).toBe(true);
});
