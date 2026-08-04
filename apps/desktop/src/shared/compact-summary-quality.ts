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
  /** Offline eval / soft diagnostics only — not used as a production compact hard reject. */
  checkGrounding?: boolean;
}

export type CompactSummaryQualityIssueCode =
  | "empty_summary"
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

/**
 * Path-like candidates. Still filtered by {@link looksLikeFilePath} so dates (`2024/01/02`)
 * and bare version fragments (`a/b`) are not treated as repo paths.
 */
const FILE_PATH_PATTERN =
  /(?:^|[\s("'`])((?:\.{0,2}[\\/])?(?:[A-Za-z0-9_.@+-]+[\\/])+[A-Za-z0-9_.@+-]+(?:\.[A-Za-z0-9]+)?(?::\d+(?::\d+)?)?)/gmu;

/** Known/typical monorepo or language tree roots — helps accept extension-less dirs. */
const PATHISH_SEGMENT =
  /^(?:apps?|packages?|src|lib|libs|bin|cmd|internal|pkg|test|tests|docs?|scripts?|tools?|desktop|main|shared|runtime|renderer|components?|hooks?|utils?|services?|models?|types?|config|configs?|public|assets?|\.\.?)$/iu;

/** Production hard gate for compact handoffs: non-empty free-form text only. */
export function isNonEmptyCompactionSummary(summary: string): boolean {
  return summary.trim().length > 0;
}

export function evaluateCompactSummaryQuality(
  summary: string,
  spec: CompactSummaryQualitySpec = {},
): CompactSummaryQualityReport {
  const issues: CompactSummaryQualityIssue[] = [];
  if (!isNonEmptyCompactionSummary(summary)) {
    issues.push({ code: "empty_summary", detail: "摘要为空" });
    return { ok: false, issues };
  }

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

/** Exported for unit tests — extraction + date/version false-positive filter. */
export function extractFilePathsForGrounding(text: string): string[] {
  return extractFilePaths(text);
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
    if (!looksLikeFilePath(candidate)) {
      continue;
    }
    paths.add(candidate);
  }
  return [...paths];
}

/**
 * Filter false positives from the wide path regex (dates, bare a/b, all-numeric segments).
 * Still accepts repo-style paths with extensions and extension-less trees under known roots.
 */
export function looksLikeFilePath(value: string): boolean {
  const path = normalizeFilePath(value);
  if (!path || path.includes("://")) {
    return false;
  }
  // ISO-ish / slash dates only.
  if (/^\d{4}\/\d{1,2}(?:\/\d{1,2})?$/.test(path)) {
    return false;
  }
  // US-style short dates (when matched as path-like).
  if (/^\d{1,2}\/\d{1,2}(?:\/\d{2,4})?$/.test(path)) {
    return false;
  }

  const segments = path.split(/[\\/]/u).filter((segment) => segment.length > 0 && segment !== "." && segment !== "..");
  if (segments.length < 2) {
    return false;
  }
  // All-numeric multi-segment → date or version indices, not files.
  if (segments.every((segment) => /^\d+$/u.test(segment))) {
    return false;
  }

  const last = segments[segments.length - 1]!;
  // Clear file path: `foo/bar.ts`, `foo/bar.test.ts`
  if (/\.[A-Za-z][A-Za-z0-9]{0,12}$/u.test(last)) {
    return true;
  }

  // Extension-less directory / module paths: need path-ish roots or enough substance.
  const hasPathishRoot = segments.some((segment) => PATHISH_SEGMENT.test(segment));
  const substantial = segments.filter((segment) => segment.length >= 2 && !/^\d+$/u.test(segment));
  // Reject thin fragments like `a/b`, `v1/v2`.
  if (segments.length === 2 && substantial.every((segment) => segment.length <= 2)) {
    return false;
  }
  if (hasPathishRoot && substantial.length >= 1) {
    return true;
  }
  if (segments.length >= 3 && substantial.length >= 2) {
    return true;
  }
  return false;
}

function normalizeFilePath(value: string): string {
  return value
    .replace(/:\d+(?::\d+)?$/u, "")
    .replaceAll("\\", "/")
    .trim();
}

function normalizeForFactMatch(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase().replaceAll("\\", "/").replace(/\s+/gu, " ").trim();
}
