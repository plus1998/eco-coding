export interface SdkFinalizePlanRequest {
  analysis: string;
  plan: string;
  rawInput: Record<string, unknown>;
}

export function parseFinalizePlanInput(input: Record<string, unknown>): SdkFinalizePlanRequest {
  const analysis = typeof input.analysis === "string" ? input.analysis.trim() : "";
  const plan = typeof input.plan === "string" ? input.plan.trim() : "";
  return {
    analysis,
    plan,
    rawInput: input,
  };
}

export interface FinalizePlanSubmission {
  analysis: string;
  plan: string;
}

export const FINALIZE_PLAN_MCP_SERVER_NAME = "eco_plan";
export const FINALIZE_PLAN_MCP_TOOL_NAME = "finalize_plan";
export const FINALIZE_PLAN_ALLOWED_TOOL = `mcp__${FINALIZE_PLAN_MCP_SERVER_NAME}__${FINALIZE_PLAN_MCP_TOOL_NAME}`;

export async function createFinalizePlanMcpServer(
  onSubmit: (submission: FinalizePlanSubmission) => void,
): Promise<unknown> {
  const sdk = await import("@anthropic-ai/claude-agent-sdk");
  const zod = await import("zod");
  const { tool, createSdkMcpServer } = sdk;
  const { z } = zod;

  const finalizePlanTool = tool(
    FINALIZE_PLAN_MCP_TOOL_NAME,
    "Submit the final implementation plan for Eco approval.",
    {
      analysis: z.string().describe("Final analysis summary for this plan."),
      plan: z.string().describe("Decision-complete implementation plan."),
    },
    async (args) => {
      const parsed = parseFinalizePlanInput({
        analysis: args.analysis,
        plan: args.plan,
      });
      onSubmit({
        analysis: parsed.analysis,
        plan: parsed.plan,
      });
      return {
        content: [{ type: "text", text: "Plan submission accepted." }],
        structuredContent: {
          analysis: parsed.analysis,
          plan: parsed.plan,
        },
      };
    },
  );

  return createSdkMcpServer({
    name: FINALIZE_PLAN_MCP_SERVER_NAME,
    version: "1.0.0",
    tools: [finalizePlanTool],
  });
}
