import {
  sdkAgentKeyForProfileAgent,
  type EcoOrchestrationStrategy,
  type EcoWorkflowStep,
} from "./agent-orchestration.js";

export interface EcoWorkflowStepOutput {
  stepId: string;
  outputKey: string;
  content: string;
}

export interface EcoWorkflowRenderContext {
  userPrompt: string;
  outputs: readonly EcoWorkflowStepOutput[];
}

export function expandFixedWorkflowSteps(
  strategy: Extract<EcoOrchestrationStrategy, { kind: "fixed" }>,
): EcoWorkflowStep[] {
  const steps = strategy.steps.map(cloneWorkflowStep);
  if (!strategy.finalAggregator) {
    return steps;
  }
  const existingStepIds = new Set(steps.map((step) => step.id));
  if (existingStepIds.has(strategy.finalAggregator.id)) {
    throw new Error(`Duplicate workflow step id: ${strategy.finalAggregator.id}`);
  }
  const aggregator = cloneWorkflowStep(strategy.finalAggregator);
  if (aggregator.dependsOn.length === 0) {
    aggregator.dependsOn = steps.map((step) => step.id);
  }
  return [...steps, aggregator];
}

export function resolveFixedWorkflowBatches(
  strategy: Extract<EcoOrchestrationStrategy, { kind: "fixed" }>,
): EcoWorkflowStep[][] {
  const steps = expandFixedWorkflowSteps(strategy);
  validateWorkflowSteps(steps);

  const remaining = [...steps];
  const completed = new Set<string>();
  const batches: EcoWorkflowStep[][] = [];

  while (remaining.length > 0) {
    const ready = remaining.filter((step) => step.dependsOn.every((dependency) => completed.has(dependency)));
    if (ready.length === 0) {
      throw new Error("Workflow contains a dependency cycle.");
    }

    const firstReady = ready[0];
    if (!firstReady) {
      throw new Error("Workflow contains a dependency cycle.");
    }
    const batch =
      firstReady.runMode === "parallel" ? ready.filter((step) => step.runMode === "parallel") : [firstReady];
    batches.push(batch);

    for (const step of batch) {
      completed.add(step.id);
      const index = remaining.findIndex((candidate) => candidate.id === step.id);
      if (index >= 0) {
        remaining.splice(index, 1);
      }
    }
  }

  return batches;
}

export function renderWorkflowStepPrompt(step: EcoWorkflowStep, context: EcoWorkflowRenderContext): string {
  const byStepId = new Map(context.outputs.map((output) => [output.stepId, output.content]));
  const byOutputKey = new Map(context.outputs.map((output) => [output.outputKey, output.content]));
  const allOutputs = context.outputs
    .map((output) => `## ${output.stepId} (${output.outputKey})\n${output.content.trim() || "(empty)"}`)
    .join("\n\n");

  return step.promptTemplate
    .replaceAll("{{userPrompt}}", context.userPrompt.trim())
    .replaceAll("{{allOutputs}}", allOutputs || "(no previous outputs)")
    .replace(
      /\{\{step\.([a-zA-Z0-9_-]+)\}\}/g,
      (_match, stepId: string) => byStepId.get(stepId)?.trim() || "(missing step output)",
    )
    .replace(
      /\{\{output\.([a-zA-Z0-9_-]+)\}\}/g,
      (_match, outputKey: string) => byOutputKey.get(outputKey)?.trim() || "(missing named output)",
    );
}

export function buildFixedWorkflowStepPrompt(input: {
  step: EcoWorkflowStep;
  renderedInstructions: string;
}): string {
  const agentKey = sdkAgentKeyForProfileAgent(input.step.agentKey);
  return [
    `Fixed workflow step: ${input.step.id}.`,
    `Run exactly this step with Agent(${agentKey}).`,
    "Do not run any other workflow step.",
    "Do not call other subagents unless the active step agent explicitly needs allowed tools for its own work.",
    "",
    "Step instructions:",
    input.renderedInstructions.trim(),
    "",
    `Return only the output for step "${input.step.id}" and satisfy output key "${input.step.outputKey}".`,
  ].join("\n");
}

export function buildHybridWorkflowGuidance(
  strategy: Extract<EcoOrchestrationStrategy, { kind: "hybrid" }>,
): string {
  const steps = strategy.recommendedSteps.map(
    (step, index) => `${index + 1}. ${step.id} -> Agent(${sdkAgentKeyForProfileAgent(step.agentKey)})`,
  );
  return [
    "Hybrid workflow recommendation:",
    ...steps,
    strategy.allowPlannerAdjustments
      ? "You may skip, add, or reorder steps when justified. State the reason when you deviate."
      : "Follow these steps unless blocked. State the blocker if you deviate.",
  ].join("\n");
}

function validateWorkflowSteps(steps: readonly EcoWorkflowStep[]): void {
  const ids = new Set<string>();
  for (const step of steps) {
    if (!step.id.trim()) {
      throw new Error("Workflow step id cannot be empty.");
    }
    if (ids.has(step.id)) {
      throw new Error(`Duplicate workflow step id: ${step.id}`);
    }
    ids.add(step.id);
  }

  for (const step of steps) {
    if (!step.agentKey.trim()) {
      throw new Error(`Workflow step ${step.id} is missing agentKey.`);
    }
    for (const dependency of step.dependsOn) {
      if (!ids.has(dependency)) {
        throw new Error(`Workflow step ${step.id} depends on missing step ${dependency}.`);
      }
      if (dependency === step.id) {
        throw new Error(`Workflow step ${step.id} cannot depend on itself.`);
      }
    }
  }
}

function cloneWorkflowStep(step: EcoWorkflowStep): EcoWorkflowStep {
  return {
    ...step,
    dependsOn: [...step.dependsOn],
  };
}
