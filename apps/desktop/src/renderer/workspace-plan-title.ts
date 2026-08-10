/**
 * Concise label for workspace plan row (title only — not path/body preview).
 */

const GENERIC_PLAN_HEADINGS = new Set([
  "plan",
  "implementation plan",
  "approved plan",
  "实现计划",
  "计划",
  "实施计划",
]);

const PLAN_HEADING_PREFIXES = [
  /^实现计划[：:]\s*/u,
  /^实施计划[：:]\s*/u,
  /^计划[：:]\s*/u,
  /^implementation\s+plan[：:\s]+/iu,
  /^approved\s+plan[：:\s]+/iu,
  /^plan[：:\s]+/iu,
];

function cleanHeading(raw: string): string {
  let title = raw.replace(/\s+/g, " ").trim();
  for (const prefix of PLAN_HEADING_PREFIXES) {
    title = title.replace(prefix, "").trim();
  }
  return title;
}

function isGenericHeading(title: string): boolean {
  return GENERIC_PLAN_HEADINGS.has(title.toLowerCase());
}

/** First meaningful markdown heading (# / ## / ###), else undefined. */
export function extractPlanTitleFromMarkdown(plan: string): string | undefined {
  const lines = plan.split(/\r?\n/);
  for (const line of lines) {
    const match = /^(#{1,3})\s+(.+?)\s*#*\s*$/.exec(line.trim());
    if (!match) {
      continue;
    }
    const cleaned = cleanHeading(match[2] ?? "");
    if (cleaned && !isGenericHeading(cleaned)) {
      return cleaned;
    }
  }
  return undefined;
}

function clampTitle(text: string, max = 64): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  if (!oneLine) {
    return "";
  }
  if (oneLine.length <= max) {
    return oneLine;
  }
  return `${oneLine.slice(0, max - 1)}…`;
}

/**
 * Prefer a real plan heading; fall back to the user goal; never the full body.
 */
export function resolveWorkspacePlanTitle(input: {
  plan?: string;
  userPrompt?: string;
  fallback?: string;
}): string {
  const fromPlan = extractPlanTitleFromMarkdown(input.plan ?? "");
  if (fromPlan) {
    return clampTitle(fromPlan);
  }
  const fromPrompt = clampTitle(input.userPrompt ?? "");
  if (fromPrompt) {
    return fromPrompt;
  }
  return (input.fallback ?? "").trim() || "计划";
}
