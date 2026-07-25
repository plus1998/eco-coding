export interface OrchestrationGuardrails {
  maxConcurrentSubagents: number;
  maxSubagentRuntimeMs: number;
}

export const DEFAULT_ORCHESTRATION_GUARDRAILS: OrchestrationGuardrails = {
  maxConcurrentSubagents: 5,
  maxSubagentRuntimeMs: 30 * 60 * 1_000,
};

export function resolveOrchestrationGuardrails(
  env: Record<string, string | undefined> = process.env,
): OrchestrationGuardrails {
  return {
    maxConcurrentSubagents: positiveNumber(env.ECO_ORCHESTRATION_MAX_CONCURRENT_SUBAGENTS, 5),
    maxSubagentRuntimeMs: positiveNumber(env.ECO_SUBAGENT_MAX_RUNTIME_MINUTES, 30) * 60 * 1_000,
  };
}

function positiveNumber(raw: string | undefined, fallback: number): number {
  if (!raw?.trim()) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}
