import type { SdkToolPermissionDecision, SdkToolPermissionRequest } from "./claude-agent-sdk";

export interface SdkFinalizePlanRequest {
  analysis: string;
  plan: string;
  rawInput: Record<string, unknown>;
}

export type SdkToolPermissionHandler = (
  request: SdkToolPermissionRequest,
) => Promise<SdkToolPermissionDecision>;

export function parseFinalizePlanInput(input: Record<string, unknown>): SdkFinalizePlanRequest {
  const analysis = typeof input.analysis === "string" ? input.analysis.trim() : "";
  const plan = typeof input.plan === "string" ? input.plan.trim() : "";
  return {
    analysis,
    plan,
    rawInput: input,
  };
}

export function createFinalizePlanHandler(
  delegate: (request: SdkFinalizePlanRequest & { toolUseId: string }) => Promise<Record<string, unknown>>,
): SdkToolPermissionHandler {
  return async (request) => {
    if (request.toolName !== "FinalizePlan") {
      return { behavior: "allow", updatedInput: request.input };
    }

    const parsed = parseFinalizePlanInput(request.input);
    const updatedInput = await delegate({
      ...parsed,
      toolUseId: request.toolUseId,
    });
    return { behavior: "allow", updatedInput };
  };
}

