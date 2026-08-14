/**
 * Eco PI extension: finalize_plan tool for Plan mode handoff (Codex-style async approval).
 * Submits the plan, ends the turn; Eco persists pending plan and waits for user approval.
 */
import { Type, type Static, type TSchema } from "typebox";
import { PI_FINALIZE_PLAN_TOOL_NAME } from "./pi-session-mode.js";

export interface EcoPiFinalizePlanExtensionApi {
  registerTool(tool: {
    name: string;
    label: string;
    description: string;
    promptSnippet?: string;
    promptGuidelines?: string[];
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

export interface CreateEcoPiFinalizePlanExtensionInput {
  /** Called when the model successfully submits a plan (before the turn ends). */
  onSubmitted: (input: { plan: string; toolCallId: string }) => void;
}

export function createEcoPiFinalizePlanExtensionFactory(
  input: CreateEcoPiFinalizePlanExtensionInput,
): (pi: EcoPiFinalizePlanExtensionApi) => void {
  return (pi) => {
    pi.registerTool({
      name: PI_FINALIZE_PLAN_TOOL_NAME,
      label: "Finalize plan",
      description:
        "Submit the complete Markdown plan. Call when the plan is ready, then stop. Do not modify files. Do not claim you submitted a plan unless you actually call this tool.",
      promptSnippet: "Submit the plan with finalize_plan (required tool call), then stop.",
      promptGuidelines: [
        "When the implementation plan is complete, you MUST call finalize_plan with the full Markdown plan.",
        "Never claim the plan is submitted unless you invoked finalize_plan.",
      ],
      parameters,
      executionMode: "sequential",
      execute: async (toolCallId, rawParams) => {
        const params = rawParams as Params;
        const plan = typeof params.plan === "string" ? params.plan.trim() : "";
        if (!plan) {
          return {
            content: [{ type: "text", text: "Plan submission failed: empty plan." }],
            details: { planLength: 0 },
          };
        }
        input.onSubmitted({ plan, toolCallId });
        return {
          content: [
            {
              type: "text",
              text: "Plan submitted. Stop.",
            },
          ],
          details: { planLength: plan.length },
        };
      },
    });
  };
}
