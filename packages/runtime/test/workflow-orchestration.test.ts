import { expect, test } from "bun:test";
import {
  buildFixedWorkflowStepPrompt,
  buildHybridWorkflowGuidance,
  renderWorkflowStepPrompt,
  resolveFixedWorkflowBatches,
  type EcoOrchestrationStrategy,
  type EcoWorkflowStep,
} from "../src";

function step(input: Partial<EcoWorkflowStep> & Pick<EcoWorkflowStep, "id" | "agentKey">): EcoWorkflowStep {
  return {
    promptTemplate: `Do ${input.id} for {{userPrompt}}`,
    dependsOn: [],
    runMode: "sequential",
    required: true,
    outputKey: `${input.id}_output`,
    failurePolicy: "stop",
    ...input,
  };
}

test("resolveFixedWorkflowBatches resolves dependencies and parallel groups", () => {
  const strategy: Extract<EcoOrchestrationStrategy, { kind: "fixed" }> = {
    kind: "fixed",
    steps: [
      step({ id: "research_a", agentKey: "researcher", runMode: "parallel" }),
      step({ id: "research_b", agentKey: "source_verifier", runMode: "parallel" }),
      step({ id: "synthesis", agentKey: "synthesizer", dependsOn: ["research_a", "research_b"] }),
    ],
    finalAggregator: step({
      id: "editor",
      agentKey: "editor",
      promptTemplate: "Edit from {{allOutputs}}",
    }),
  };

  const batches = resolveFixedWorkflowBatches(strategy);

  expect(batches.map((batch) => batch.map((entry) => entry.id))).toEqual([
    ["research_a", "research_b"],
    ["synthesis"],
    ["editor"],
  ]);
  expect(batches[2]?.[0]?.dependsOn).toEqual(["research_a", "research_b", "synthesis"]);
});

test("resolveFixedWorkflowBatches rejects missing dependencies and cycles", () => {
  expect(() =>
    resolveFixedWorkflowBatches({
      kind: "fixed",
      steps: [step({ id: "a", agentKey: "researcher", dependsOn: ["missing"] })],
    }),
  ).toThrow("depends on missing step missing");

  expect(() =>
    resolveFixedWorkflowBatches({
      kind: "fixed",
      steps: [
        step({ id: "a", agentKey: "researcher", dependsOn: ["b"] }),
        step({ id: "b", agentKey: "synthesizer", dependsOn: ["a"] }),
      ],
    }),
  ).toThrow("dependency cycle");
});

test("renderWorkflowStepPrompt substitutes user prompt and previous outputs", () => {
  const rendered = renderWorkflowStepPrompt(
    step({
      id: "synthesis",
      agentKey: "synthesizer",
      promptTemplate: "Answer {{userPrompt}} from {{step.research}} and {{output.sources}}.",
    }),
    {
      userPrompt: "market landscape",
      outputs: [{ stepId: "research", outputKey: "sources", content: "source notes" }],
    },
  );

  expect(rendered).toBe("Answer market landscape from source notes and source notes.");
});

test("buildFixedWorkflowStepPrompt pins the exact Eco agent key", () => {
  const prompt = buildFixedWorkflowStepPrompt({
    step: step({ id: "verify", agentKey: "source verifier" }),
    renderedInstructions: "Check citations.",
  });

  expect(prompt).toContain("Fixed workflow step: verify.");
  expect(prompt).toContain("Agent(eco_source_verifier)");
  expect(prompt).toContain("Check citations.");
});

test("buildHybridWorkflowGuidance requires deviation reasons", () => {
  const guidance = buildHybridWorkflowGuidance({
    kind: "hybrid",
    recommendedSteps: [step({ id: "research", agentKey: "researcher" })],
    allowPlannerAdjustments: true,
  });

  expect(guidance).toContain("Agent(eco_researcher)");
  expect(guidance).toContain("State the reason when you deviate");
});
