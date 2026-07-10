import { expect, test } from "bun:test";
import {
  type CompactSummaryQualitySpec,
  evaluateCompactSummaryQuality,
  hasCompleteStructuredCompactSections,
} from "../src/shared/compact-summary-quality";

interface GoldenCase extends CompactSummaryQualitySpec {
  id: string;
  expectedOk: boolean;
  summary: string;
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
    [
      "## 任务目标",
      "修复问题。",
      "## 已读/已改文件",
      "apps/desktop/src/main/invented.ts",
      "## 测试结果与错误",
      "未执行。",
      "## 已做决策",
      "继续调查。",
      "## 未完成事项",
      "定位真实文件。",
    ].join("\n"),
    { sourceTexts: ["只检查了 apps/desktop/src/main/index.ts"], checkGrounding: true },
  );
  expect(report.issues.map((issue) => issue.code)).toContain("unsupported_file_path");
});

test("structured section check requires every non-empty section in order", () => {
  expect(hasCompleteStructuredCompactSections(goldenCases[0]?.summary ?? "")).toBe(true);
  expect(hasCompleteStructuredCompactSections("## 任务目标\n只有一段")).toBe(false);
});
