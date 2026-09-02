import type { AnthropicProxyRoute } from "./anthropic-proxy";
import { buildApprovalReviewSystemPrompt } from "./approval-policy";
import { postAuxiliaryBridgeRequest, resolveRouteApiCompat } from "./bridge-auxiliary-request";
import {
  type ApprovalActivityLine,
  type BuildApprovalEnvelopeResult,
  buildApprovalEnvelope,
  type EcoApprovalEnvelopeV2,
} from "./eco-approval-evidence";

const REVIEW_TIMEOUT_MS = 30_000;

/** Legacy simple envelope used by tests and partial callers. */
export interface EcoApprovalLegacyEnvelope {
  userRequest: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  cwd: string;
  workspacePath: string;
  reason: string;
  riskScore?: number;
  riskLevel?: string;
  source?: string;
}

export type EcoApprovalEnvelope = EcoApprovalEnvelopeV2 | EcoApprovalLegacyEnvelope;

export type EcoApprovalReviewResult =
  | { action: "allow"; rationale: string; riskLevel: string; policyMatches: string[] }
  | { action: "human_required"; rationale: string; riskLevel?: string; policyMatches: string[] }
  | { action: "deny"; rationale: string; policyMatches: string[] };

const REVIEW_SCHEMA = {
  type: "object",
  properties: {
    risk_level: { type: "string", enum: ["low", "medium", "high", "critical"] },
    user_authorization: { type: "string", enum: ["unknown", "low", "medium", "high"] },
    decision: { type: "string", enum: ["allow", "human_required", "deny"] },
    policy_matches: { type: "array", items: { type: "string" } },
    rationale: { type: "string" },
  },
  required: ["risk_level", "user_authorization", "decision", "policy_matches", "rationale"],
  additionalProperties: false,
} as const;

function isV2Envelope(envelope: EcoApprovalEnvelope): envelope is EcoApprovalEnvelopeV2 {
  return (
    Array.isArray((envelope as EcoApprovalEnvelopeV2).transcript) &&
    Boolean((envelope as EcoApprovalEnvelopeV2).plannedAction)
  );
}

function normalizeEnvelope(envelope: EcoApprovalEnvelope): BuildApprovalEnvelopeResult {
  if (isV2Envelope(envelope)) {
    return {
      ok: true,
      envelope,
      serialized: JSON.stringify(envelope),
    };
  }

  return buildApprovalEnvelope({
    activityLines: [],
    initialPrompt: envelope.userRequest,
    toolName: envelope.toolName,
    toolInput: envelope.toolInput,
    cwd: envelope.cwd,
    workspacePath: envelope.workspacePath,
    reason: envelope.reason,
    ...(envelope.riskScore !== undefined ? { riskScore: envelope.riskScore } : {}),
    ...(envelope.riskLevel !== undefined ? { riskLevel: envelope.riskLevel } : {}),
    ...(envelope.source ? { source: envelope.source } : {}),
  });
}

export async function reviewEcoApproval(input: {
  route: AnthropicProxyRoute;
  envelope: EcoApprovalEnvelope;
  /** Pre-serialized user content; when set, reused for both retry attempts. */
  serializedEnvelope?: string;
  /** App locale (e.g. zh-CN / en-US); controls `rationale` language only. */
  locale?: string;
  fetcher?: typeof fetch;
}): Promise<EcoApprovalReviewResult> {
  const built = normalizeEnvelope(input.envelope);
  if (!built.ok) {
    return {
      action: "human_required",
      rationale: built.rationale,
      policyMatches: built.policyMatches,
    };
  }
  const serialized = input.serializedEnvelope ?? built.serialized;
  const systemPrompt = buildApprovalReviewSystemPrompt(undefined, input.locale);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REVIEW_TIMEOUT_MS);
  try {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await postAuxiliaryBridgeRequest({
        route: input.route,
        anthropicBody: {
          model: input.route.modelId,
          temperature: 0,
          thinking: { type: "disabled" },
          max_tokens: Math.min(input.route.maxOutputTokens ?? 800, 800),
          system: systemPrompt,
          messages: [{ role: "user", content: serialized }],
          output_format: { type: "json_schema", schema: REVIEW_SCHEMA },
        },
        ...(resolveRouteApiCompat(input.route) === "anthropic"
          ? { anthropicExtraHeaders: { "anthropic-beta": "structured-outputs-2025-11-13" } }
          : {}),
        signal: controller.signal,
        logEventPrefix: "eco-approval-review",
        ...(input.fetcher ? { fetcher: input.fetcher } : {}),
      });
      const parsed = parseReviewResponse(response.text);
      if (response.ok && parsed) {
        if (parsed.risk_level === "critical") {
          return {
            action: "deny",
            rationale: parsed.rationale,
            policyMatches: parsed.policy_matches,
          };
        }
        if (parsed.decision === "deny") {
          return {
            action: "deny",
            rationale: parsed.rationale,
            policyMatches: parsed.policy_matches,
          };
        }
        if (
          parsed.decision === "allow" &&
          (parsed.risk_level !== "high" ||
            parsed.user_authorization === "medium" ||
            parsed.user_authorization === "high")
        ) {
          return {
            action: "allow",
            rationale: parsed.rationale,
            riskLevel: parsed.risk_level,
            policyMatches: parsed.policy_matches,
          };
        }
        return {
          action: "human_required",
          rationale: parsed.rationale,
          riskLevel: parsed.risk_level,
          policyMatches: parsed.policy_matches,
        };
      }
    }
    return {
      action: "human_required",
      rationale: "辅助模型审批失败或返回了无效 JSON，已按失败关闭策略转人工审批。",
      policyMatches: ["review_failed_closed"],
    };
  } catch (error) {
    return {
      action: "human_required",
      rationale: `辅助模型审批失败，已按失败关闭策略转人工审批：${
        error instanceof Error ? error.message : String(error)
      }`,
      policyMatches: ["review_failed_closed"],
    };
  } finally {
    clearTimeout(timeout);
  }
}

export function buildThreadApprovalEnvelope(input: {
  activityLines: readonly ApprovalActivityLine[];
  initialPrompt: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  cwd: string;
  workspacePath: string;
  reason: string;
  riskScore?: number;
  riskLevel?: string;
  source?: string;
}): BuildApprovalEnvelopeResult {
  return buildApprovalEnvelope(input);
}

interface ParsedReviewResponse {
  risk_level: "low" | "medium" | "high" | "critical";
  user_authorization: "unknown" | "low" | "medium" | "high";
  decision: "allow" | "human_required" | "deny";
  policy_matches: string[];
  rationale: string;
}

function parseReviewResponse(text: string | undefined): ParsedReviewResponse | undefined {
  const trimmed = text?.trim();
  if (!trimmed) {
    return undefined;
  }

  const candidates = splitAdjacentJsonObjects(trimmed);
  if (!candidates || candidates.length === 0) {
    return undefined;
  }

  const parsed = candidates.map(parseReviewObject);
  if (parsed.some((value) => value === undefined)) {
    return undefined;
  }
  const reviews = parsed as ParsedReviewResponse[];
  const canonical = JSON.stringify(reviews[0]);
  if (reviews.some((review) => JSON.stringify(review) !== canonical)) {
    return undefined;
  }
  return reviews[0];
}

function parseReviewObject(raw: string): ParsedReviewResponse | undefined {
  let value: Record<string, unknown>;
  try {
    value = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return undefined;
  }
  const keys = Object.keys(value).sort();
  const expected = ["decision", "policy_matches", "rationale", "risk_level", "user_authorization"];
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    return undefined;
  }
  if (!(["low", "medium", "high", "critical"] as unknown[]).includes(value.risk_level)) {
    return undefined;
  }
  if (!(["unknown", "low", "medium", "high"] as unknown[]).includes(value.user_authorization)) {
    return undefined;
  }
  if (value.decision !== "allow" && value.decision !== "human_required" && value.decision !== "deny") {
    return undefined;
  }
  if (!Array.isArray(value.policy_matches) || value.policy_matches.some((item) => typeof item !== "string")) {
    return undefined;
  }
  if (typeof value.rationale !== "string" || !value.rationale.trim()) {
    return undefined;
  }
  return value as unknown as ParsedReviewResponse;
}

function splitAdjacentJsonObjects(text: string): string[] | undefined {
  const objects: string[] = [];
  let offset = 0;

  while (offset < text.length) {
    while (/\s/.test(text[offset] ?? "")) {
      offset += 1;
    }
    if (offset >= text.length) {
      break;
    }
    if (text[offset] !== "{") {
      return undefined;
    }

    const start = offset;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (; offset < text.length; offset += 1) {
      const char = text[offset];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (char === "\\") {
          escaped = true;
        } else if (char === '"') {
          inString = false;
        }
        continue;
      }
      if (char === '"') {
        inString = true;
      } else if (char === "{") {
        depth += 1;
      } else if (char === "}") {
        depth -= 1;
        if (depth === 0) {
          objects.push(text.slice(start, offset + 1));
          offset += 1;
          break;
        }
      }
    }
    if (depth !== 0 || inString) {
      return undefined;
    }
  }

  return objects;
}
