import policyTemplate from "./policy_template.md" with { type: "text" };
import policyTenant from "./policy.md" with { type: "text" };

const OUTPUT_CONTRACT = [
  "Return exactly one JSON object matching the supplied schema and no other text.",
  'The JSON object must contain exactly these five required fields: {"risk_level":"low|medium|high|critical","user_authorization":"unknown|low|medium|high","decision":"allow|human_required|deny","policy_matches":["policy_id"],"rationale":"concise explanation"}.',
  "Put the main risk reason in `rationale` so a human can understand why auto-approval was withheld.",
].join(" ");

function rationaleLanguageInstruction(locale?: string): string {
  const normalized = locale?.trim().toLowerCase() ?? "";
  if (normalized.startsWith("zh")) {
    return "Write the `rationale` field in Simplified Chinese (简体中文). Keep enum fields (risk_level, user_authorization, decision, policy_matches) in English as specified by the schema.";
  }
  if (normalized.startsWith("en")) {
    return "Write the `rationale` field in English. Keep enum fields (risk_level, user_authorization, decision, policy_matches) in English as specified by the schema.";
  }
  // Default Eco UI falls back to zh-CN when system locale is unknown.
  return "Write the `rationale` field in Simplified Chinese (简体中文). Keep enum fields (risk_level, user_authorization, decision, policy_matches) in English as specified by the schema.";
}

/** Assemble system prompt from policy markdown (auditable sources) + Eco output contract. */
export function buildApprovalReviewSystemPrompt(
  tenantPolicyConfig: string = String(policyTenant).trim(),
  locale?: string,
): string {
  const template = String(policyTemplate).trimEnd();
  const body = template.replace("{tenant_policy_config}", tenantPolicyConfig.trim());
  return `${body}\n\n${OUTPUT_CONTRACT}\n${rationaleLanguageInstruction(locale)}`;
}

/** Default prompt without explicit locale (uses Chinese rationale instruction). */
export const APPROVAL_REVIEW_SYSTEM_PROMPT = buildApprovalReviewSystemPrompt();
