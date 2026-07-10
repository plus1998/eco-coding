import { STRUCTURED_COMPACT_HEADINGS } from "@eco/runtime";

export type CompactSummaryRequiredFactCategory =
  | "filePaths"
  | "commands"
  | "errors"
  | "unfinished"
  | "constraints"
  | "decisions";

export interface CompactSummaryQualitySpec {
  sourceTexts?: readonly string[];
  requiredFacts?: Partial<Record<CompactSummaryRequiredFactCategory, readonly string[]>>;
  forbiddenClaims?: readonly string[];
  /** Enables deterministic provenance checks that are safe enough for runtime rejection. */
  checkGrounding?: boolean;
}

export type CompactSummaryQualityIssueCode =
  | "missing_section"
  | "empty_section"
  | "missing_required_fact"
  | "forbidden_claim"
  | "unsupported_file_path"
  | "unsupported_universal_test_success";

export interface CompactSummaryQualityIssue {
  code: CompactSummaryQualityIssueCode;
  detail: string;
  category?: CompactSummaryRequiredFactCategory;
  value?: string;
}

export interface CompactSummaryQualityReport {
  ok: boolean;
  issues: CompactSummaryQualityIssue[];
}

const UNIVERSAL_TEST_SUCCESS_PATTERNS = [
  /(?:全量|全部|所有)\s*(?:测试|test)[^。；;\n]{0,24}(?:通过|成功|pass(?:ed|ing)?)/iu,
  /\b(?:all|entire|full)\s+(?:test\s+suite|tests?)\s+(?:pass|passed|passing|succeeded)\b/iu,
] as const;

const FILE_PATH_PATTERN =
  /(?:^|[\s("'`])((?:\.{0,2}[\\/])?(?:[A-Za-z0-9_.@+-]+[\\/])+[A-Za-z0-9_.@+-]+(?:\.[A-Za-z0-9]+)?(?::\d+(?::\d+)?)?)/gmu;

export function hasCompleteStructuredCompactSections(summary: string): boolean {
  const normalizedSummary = summary.trim();
  if (!normalizedSummary) {
    return false;
  }
  const sections: Array<{ start: number; contentStart: number }> = [];
  for (const heading of STRUCTURED_COMPACT_HEADINGS) {
    const match = new RegExp(`^##\\s+${escapeRegExp(heading)}\\s*$`, "mu").exec(normalizedSummary);
    if (!match) {
      return false;
    }
    sections.push({ start: match.index, contentStart: match.index + match[0].length });
  }
  for (let index = 0; index < sections.length; index += 1) {
    const section = sections[index];
    if (!section) {
      return false;
    }
    const next = sections[index + 1];
    if (next && next.start <= section.start) {
      return false;
    }
    if (!normalizedSummary.slice(section.contentStart, next?.start ?? normalizedSummary.length).trim()) {
      return false;
    }
  }
  return true;
}

export function evaluateCompactSummaryQuality(
  summary: string,
  spec: CompactSummaryQualitySpec = {},
): CompactSummaryQualityReport {
  const issues: CompactSummaryQualityIssue[] = [];
  collectSectionIssues(summary, issues);

  const normalizedSummary = normalizeForFactMatch(summary);
  for (const [category, facts] of Object.entries(spec.requiredFacts ?? {}) as Array<
    [CompactSummaryRequiredFactCategory, readonly string[]]
  >) {
    for (const fact of facts) {
      const normalizedFact = normalizeForFactMatch(fact);
      if (normalizedFact && !normalizedSummary.includes(normalizedFact)) {
        issues.push({
          code: "missing_required_fact",
          category,
          value: fact,
          detail: `${category} 缺少关键事实：${fact}`,
        });
      }
    }
  }

  for (const claim of spec.forbiddenClaims ?? []) {
    const normalizedClaim = normalizeForFactMatch(claim);
    if (normalizedClaim && normalizedSummary.includes(normalizedClaim)) {
      issues.push({
        code: "forbidden_claim",
        value: claim,
        detail: `出现禁止断言：${claim}`,
      });
    }
  }

  if (spec.checkGrounding) {
    collectGroundingIssues(summary, spec.sourceTexts ?? [], issues);
  }

  return { ok: issues.length === 0, issues };
}

export function formatCompactSummaryQualityIssues(report: CompactSummaryQualityReport): string {
  return report.issues.map((issue) => `${issue.code}: ${issue.detail}`).join("；");
}

function collectSectionIssues(summary: string, issues: CompactSummaryQualityIssue[]): void {
  const sections: Array<{ heading: string; start: number; contentStart: number }> = [];
  for (const heading of STRUCTURED_COMPACT_HEADINGS) {
    const match = new RegExp(`^##\\s+${escapeRegExp(heading)}\\s*$`, "mu").exec(summary);
    if (!match) {
      issues.push({ code: "missing_section", detail: `缺少结构化章节：${heading}` });
      continue;
    }
    sections.push({ heading, start: match.index, contentStart: match.index + match[0].length });
  }
  if (sections.length !== STRUCTURED_COMPACT_HEADINGS.length) {
    return;
  }
  for (let index = 0; index < sections.length; index += 1) {
    const section = sections[index];
    if (!section) {
      continue;
    }
    const next = sections[index + 1];
    if (next && next.start <= section.start) {
      issues.push({ code: "missing_section", detail: `章节顺序无效：${section.heading}` });
      continue;
    }
    if (!summary.slice(section.contentStart, next?.start ?? summary.length).trim()) {
      issues.push({ code: "empty_section", detail: `结构化章节为空：${section.heading}` });
    }
  }
}

function collectGroundingIssues(
  summary: string,
  sourceTexts: readonly string[],
  issues: CompactSummaryQualityIssue[],
): void {
  const sourceCorpus = sourceTexts.join("\n");
  const normalizedSource = normalizeForFactMatch(sourceCorpus);
  for (const filePath of extractFilePaths(summary)) {
    const normalizedPath = normalizeFilePath(filePath);
    if (!normalizedPath || normalizedSource.includes(normalizeForFactMatch(normalizedPath))) {
      continue;
    }
    issues.push({
      code: "unsupported_file_path",
      category: "filePaths",
      value: filePath,
      detail: `摘要中的文件路径没有输入依据：${filePath}`,
    });
  }

  for (const pattern of UNIVERSAL_TEST_SUCCESS_PATTERNS) {
    const summaryClaim = summary.match(pattern)?.[0];
    if (summaryClaim && !pattern.test(sourceCorpus)) {
      issues.push({
        code: "unsupported_universal_test_success",
        category: "errors",
        value: summaryClaim,
        detail: `摘要声称全量测试成功，但输入没有同等断言：${summaryClaim}`,
      });
    }
    pattern.lastIndex = 0;
  }
}

function extractFilePaths(text: string): string[] {
  const paths = new Set<string>();
  for (const match of text.matchAll(FILE_PATH_PATTERN)) {
    const candidate = match[1]?.trim();
    if (!candidate || candidate.includes("://")) {
      continue;
    }
    paths.add(candidate);
  }
  return [...paths];
}

function normalizeFilePath(value: string): string {
  return value
    .replace(/:\d+(?::\d+)?$/, "")
    .replaceAll("\\", "/")
    .trim();
}

function normalizeForFactMatch(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase().replaceAll("\\", "/").replace(/\s+/gu, " ").trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
