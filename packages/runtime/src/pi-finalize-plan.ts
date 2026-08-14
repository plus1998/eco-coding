/**
 * Eco PI extension: finalize_plan tool for Plan mode handoff.
 */
import { Type, type Static, type TSchema } from "typebox";
import { PI_FINALIZE_PLAN_TOOL_NAME } from "./pi-session-mode.js";

export interface EcoPiFinalizePlanExtensionApi {
  registerTool(tool: {
    name: string;
    label: string;
    description: string;
    promptSnippet?: string;
    parameters: TSchema;
    executionMode?: "sequential" | "parallel";
    execute: (
      toolCallId: string,
      params: Record<string, unknown>,
      signal: AbortSignal | undefined,
      onUpdate: ((partial: { content: Array<{ type: "text"; text: string }>; details: unknown }) => void) | undefined,
      ctx: { cwd: string },
    ) => Promise<{ content: Array<{ type: "text"; text: string }>; details: unknown }>;
  }): void;
}

const parameters = Type.Object({
  plan: Type.String({
    minLength: 1,
    description: "Complete implementation plan in Markdown (numbered steps preferred).",
  }),
});

type Params = Static<typeof parameters>;

export const PI_FINALIZE_PLAN_EXTENSION_NAME = "eco-pi-finalize-plan" as const;

export function createEcoPiFinalizePlanExtensionFactory(): (pi: EcoPiFinalizePlanExtensionApi) => void {
  return (pi) => {
    pi.registerTool({
      name: PI_FINALIZE_PLAN_TOOL_NAME,
      label: "Finalize plan",
      description:
        "Submit the complete implementation plan for Eco user approval. Call only when the plan is ready. Do not modify files before approval.",
      promptSnippet: "Submit plan for user approval via finalize_plan.",
      parameters,
      executionMode: "sequential",
      execute: async (_toolCallId, rawParams) => {
        const params = rawParams as Params;
        const plan = typeof params.plan === "string" ? params.plan.trim() : "";
        return {
          content: [
            {
              type: "text",
              text: plan
                ? "Plan submitted and approved in Eco. End your turn; Agent execution will continue separately with full tools."
                : "Plan submission failed: empty plan.",
            },
          ],
          details: { planLength: plan.length },
        };
      },
    });
  };
}
