/**
 * Thinking budget rectifier (CC thinking_budget_rectifier.rs).
 * On budget constraint errors, adjust budget_tokens / max_tokens and retry once.
 */

const MAX_THINKING_BUDGET = 32000;
const MAX_TOKENS_VALUE = 64000;
const MIN_MAX_TOKENS_FOR_BUDGET = MAX_THINKING_BUDGET + 1;

export interface BudgetRectifySnapshot {
  maxTokens: number | undefined;
  thinkingType: string | undefined;
  thinkingBudgetTokens: number | undefined;
}

export interface BudgetRectifyResult {
  applied: boolean;
  before: BudgetRectifySnapshot;
  after: BudgetRectifySnapshot;
}

export function shouldRectifyThinkingBudget(
  errorMessage: string | undefined,
): boolean {
  if (errorMessage === undefined || errorMessage === "") {
    return false;
  }
  const lower = errorMessage.toLowerCase();

  const hasBudgetTokensReference =
    lower.includes("budget_tokens") || lower.includes("budget tokens");
  const hasThinkingReference = lower.includes("thinking");
  const has1024Constraint =
    lower.includes("greater than or equal to 1024") ||
    lower.includes(">= 1024") ||
    (lower.includes("1024") && lower.includes("input should be"));

  return hasBudgetTokensReference && hasThinkingReference && has1024Constraint;
}

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function snapshotBudget(body: JsonRecord): BudgetRectifySnapshot {
  const thinking = isRecord(body.thinking) ? body.thinking : undefined;
  return {
    maxTokens: asNumber(body.max_tokens),
    thinkingType:
      thinking !== undefined && typeof thinking.type === "string"
        ? thinking.type
        : undefined,
    thinkingBudgetTokens:
      thinking !== undefined ? asNumber(thinking.budget_tokens) : undefined,
  };
}

/** Adjust thinking.budget_tokens / max_tokens per CC budget rectifier. */
export function rectifyThinkingBudget(body: JsonRecord): BudgetRectifyResult {
  const before = snapshotBudget(body);

  if (before.thinkingType === "adaptive") {
    return { applied: false, before, after: before };
  }

  if (!isRecord(body.thinking)) {
    body.thinking = {};
  }
  const thinking = body.thinking as JsonRecord;
  thinking.type = "enabled";
  thinking.budget_tokens = MAX_THINKING_BUDGET;

  if (
    before.maxTokens === undefined ||
    before.maxTokens < MIN_MAX_TOKENS_FOR_BUDGET
  ) {
    body.max_tokens = MAX_TOKENS_VALUE;
  }

  const after = snapshotBudget(body);
  return {
    applied:
      before.maxTokens !== after.maxTokens ||
      before.thinkingType !== after.thinkingType ||
      before.thinkingBudgetTokens !== after.thinkingBudgetTokens,
    before,
    after,
  };
}
