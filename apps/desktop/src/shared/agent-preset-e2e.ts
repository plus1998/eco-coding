import {
  buildFixedWorkflowStepPrompt,
  buildHybridWorkflowGuidance,
  buildMainAgentSystemPrompt,
  buildToolPermissionPolicyFromProfile,
  createAgentDefinitionsFromProfile,
  type EcoWorkflowStepOutput,
  renderWorkflowStepPrompt,
  resolveFixedWorkflowBatches,
  sdkAgentKeyForProfileAgent,
} from "@eco/runtime";
import type { AgentTemplate, ModelRef, OrchestrationProfile, WorkflowStep } from "./agent-orchestration";
import {
  buildOrchestrationProfileFromPreset,
  createBuiltInAgentTemplates,
  createBuiltInPresetCatalog,
} from "./agent-orchestration";

export interface BuiltInPresetE2ETaskScenario {
  id: string;
  presetId: OrchestrationProfile["preset"];
  presetName: string;
  taskTitle: string;
  userPrompt: string;
  expectedOutcome: string;
  successCriteria: string[];
  expectedAgentKeys: string[];
  profile: OrchestrationProfile;
}

export interface PresetE2ETaskStepResult {
  stepId: string;
  agentKey: string;
  sdkAgentKey: string;
  outputKey: string;
  prompt: string;
  output: string;
  batchIndex: number;
}

export interface PresetE2ETaskRunResult {
  scenarioId: string;
  presetId: OrchestrationProfile["preset"];
  ok: boolean;
  errors: string[];
  runtimeAgentKeys: string[];
  workflowKind: OrchestrationProfile["strategy"]["kind"];
  steps: PresetE2ETaskStepResult[];
  finalArtifact: string;
}

export interface PresetE2ETaskSuiteReport {
  ok: boolean;
  scenarioCount: number;
  presetIds: OrchestrationProfile["preset"][];
  scenariosPerPreset: Record<string, number>;
  results: PresetE2ETaskRunResult[];
}

const PRESET_E2E_MODEL_REF: ModelRef = {
  providerId: "e2e-provider",
  modelId: "e2e-model",
  apiCompat: "anthropic",
};

export function createBuiltInPresetE2ETaskScenarios(
  modelRef: ModelRef = PRESET_E2E_MODEL_REF,
): BuiltInPresetE2ETaskScenario[] {
  const templates = createBuiltInAgentTemplates();
  return createBuiltInPresetCatalog().flatMap((preset) =>
    preset.examples.map((example, index) => {
      const evalCase = preset.evals[index];
      if (!evalCase) {
        throw new Error(`Preset ${preset.id} example ${example.id} is missing a paired eval case.`);
      }
      return {
        id: `${preset.id}.${example.id}`,
        presetId: preset.id,
        presetName: preset.name,
        taskTitle: example.title,
        userPrompt: example.prompt,
        expectedOutcome: example.expectedOutcome,
        successCriteria: [...evalCase.successCriteria],
        expectedAgentKeys: [...evalCase.expectedAgentKeys],
        profile: buildOrchestrationProfileFromPreset(preset, {
          id: `e2e.${preset.id}.${example.id}`,
          name: `${preset.name} E2E - ${example.title}`,
          modelRef,
          templates,
          source: "project",
          updatedAt: "2026-06-08T00:00:00.000Z",
        }),
      };
    }),
  );
}

export function runPresetE2ETaskScenario(
  scenario: BuiltInPresetE2ETaskScenario,
  templates: readonly AgentTemplate[] = createBuiltInAgentTemplates(),
): PresetE2ETaskRunResult {
  const errors: string[] = [];
  const enabledAgents = scenario.profile.agents.filter((agent) => agent.enabled);
  const enabledAgentKeys = new Set(enabledAgents.map((agent) => agent.agentKey));
  const runtimeAgentKeys: string[] = [];
  const steps: PresetE2ETaskStepResult[] = [];

  for (const agentKey of scenario.expectedAgentKeys) {
    if (!enabledAgentKeys.has(agentKey)) {
      errors.push(`Expected E2E agent is not enabled: ${agentKey}`);
    }
  }

  let mainPrompt = "";
  try {
    mainPrompt = stringifySystemPrompt(
      buildMainAgentSystemPrompt(scenario.profile, templates, "E2E_TASK_RUN", {
        excludeDynamicSections: scenario.profile.preset === "coding",
      }),
    );
  } catch (caught) {
    errors.push(`Main prompt cannot be built: ${errorMessage(caught)}`);
  }

  try {
    const resolved = createAgentDefinitionsFromProfile(scenario.profile, templates);
    runtimeAgentKeys.push(...resolved.agentKeys);
    for (const agent of enabledAgents) {
      const sdkKey = sdkAgentKeyForProfileAgent(agent.agentKey);
      if (!resolved.agentKeys.includes(sdkKey)) {
        errors.push(`Runtime definitions are missing ${sdkKey}`);
      }
      if (!mainPrompt.includes(`Agent(${sdkKey})`)) {
        errors.push(`Main prompt roster is missing ${sdkKey}`);
      }
    }
  } catch (caught) {
    errors.push(`Runtime agent definitions cannot be built: ${errorMessage(caught)}`);
  }

  try {
    const policy = buildToolPermissionPolicyFromProfile(scenario.profile, templates, {
      agentKeys: runtimeAgentKeys,
    });
    if (enabledAgents.length > 0 && !policy.main.allowed.includes("Agent")) {
      errors.push("Main agent must allow Agent for E2E task execution.");
    }
    for (const sdkKey of runtimeAgentKeys) {
      if (!policy.agents[sdkKey]) {
        errors.push(`Runtime tool policy is missing ${sdkKey}`);
      }
    }
  } catch (caught) {
    errors.push(`Runtime tool policy cannot be built: ${errorMessage(caught)}`);
  }

  for (const step of collectStrategySteps(scenario.profile)) {
    if (!enabledAgentKeys.has(step.agentKey)) {
      errors.push(`Workflow step references disabled or missing agent: ${step.id} -> ${step.agentKey}`);
    }
  }

  try {
    steps.push(...runWorkflowSteps(scenario));
  } catch (caught) {
    errors.push(`Workflow steps cannot be simulated: ${errorMessage(caught)}`);
  }

  const finalArtifact = buildFinalArtifact(scenario, steps);
  errors.push(...validateFinalArtifact(scenario, finalArtifact, steps));

  return {
    scenarioId: scenario.id,
    presetId: scenario.presetId,
    ok: errors.length === 0,
    errors,
    runtimeAgentKeys,
    workflowKind: scenario.profile.strategy.kind,
    steps,
    finalArtifact,
  };
}

export function createBuiltInPresetE2ETaskSuiteReport(
  scenarios: readonly BuiltInPresetE2ETaskScenario[] = createBuiltInPresetE2ETaskScenarios(),
  templates: readonly AgentTemplate[] = createBuiltInAgentTemplates(),
): PresetE2ETaskSuiteReport {
  const results = scenarios.map((scenario) => runPresetE2ETaskScenario(scenario, templates));
  const scenariosPerPreset: Record<string, number> = {};
  for (const scenario of scenarios) {
    scenariosPerPreset[scenario.presetId] = (scenariosPerPreset[scenario.presetId] ?? 0) + 1;
  }
  return {
    ok: results.every((result) => result.ok),
    scenarioCount: scenarios.length,
    presetIds: [...new Set(scenarios.map((scenario) => scenario.presetId))],
    scenariosPerPreset,
    results,
  };
}

function runWorkflowSteps(scenario: BuiltInPresetE2ETaskScenario): PresetE2ETaskStepResult[] {
  if (scenario.profile.strategy.kind === "autonomous") {
    const agentKey =
      scenario.expectedAgentKeys[0] ?? scenario.profile.agents.find((agent) => agent.enabled)?.agentKey;
    if (!agentKey) {
      throw new Error("Autonomous E2E scenario has no enabled agent.");
    }
    return [
      buildStepResult({
        scenario,
        step: {
          id: "autonomous",
          agentKey,
          promptTemplate: `Autonomously complete {{userPrompt}} and satisfy ${scenario.expectedOutcome}.`,
          dependsOn: [],
          runMode: "sequential",
          required: true,
          outputKey: "final",
          failurePolicy: "stop",
        },
        renderedPrompt: scenario.profile.strategy.guidancePrompt ?? scenario.userPrompt,
        outputs: [],
        batchIndex: 0,
      }),
    ];
  }

  if (scenario.profile.strategy.kind === "fixed") {
    const outputs: EcoWorkflowStepOutput[] = [];
    const results: PresetE2ETaskStepResult[] = [];
    const batches = resolveFixedWorkflowBatches(scenario.profile.strategy);
    batches.forEach((batch, batchIndex) => {
      for (const step of batch) {
        const renderedPrompt = renderWorkflowStepPrompt(step, {
          userPrompt: scenario.userPrompt,
          outputs,
        });
        const result = buildStepResult({ scenario, step, renderedPrompt, outputs, batchIndex });
        results.push(result);
        outputs.push({ stepId: step.id, outputKey: step.outputKey, content: result.output });
      }
    });
    return results;
  }

  const outputs: EcoWorkflowStepOutput[] = [];
  const results: PresetE2ETaskStepResult[] = [];
  const guidance = buildHybridWorkflowGuidance(scenario.profile.strategy);
  scenario.profile.strategy.recommendedSteps.forEach((step, batchIndex) => {
    const renderedPrompt = renderWorkflowStepPrompt(step, {
      userPrompt: scenario.userPrompt,
      outputs,
    });
    const result = buildStepResult({
      scenario,
      step,
      renderedPrompt: `${guidance}\n\n${renderedPrompt}`,
      outputs,
      batchIndex,
    });
    results.push(result);
    outputs.push({ stepId: step.id, outputKey: step.outputKey, content: result.output });
  });
  return results;
}

function buildStepResult(input: {
  scenario: BuiltInPresetE2ETaskScenario;
  step: WorkflowStep;
  renderedPrompt: string;
  outputs: readonly EcoWorkflowStepOutput[];
  batchIndex: number;
}): PresetE2ETaskStepResult {
  const sdkAgentKey = sdkAgentKeyForProfileAgent(input.step.agentKey);
  const prompt =
    input.scenario.profile.strategy.kind === "fixed"
      ? buildFixedWorkflowStepPrompt({
          step: input.step,
          renderedInstructions: input.renderedPrompt,
        })
      : input.renderedPrompt;
  return {
    stepId: input.step.id,
    agentKey: input.step.agentKey,
    sdkAgentKey,
    outputKey: input.step.outputKey,
    prompt,
    output: buildSimulatedStepOutput(input.scenario, input.step, input.outputs),
    batchIndex: input.batchIndex,
  };
}

function buildSimulatedStepOutput(
  scenario: BuiltInPresetE2ETaskScenario,
  step: WorkflowStep,
  outputs: readonly EcoWorkflowStepOutput[],
): string {
  return [
    `Preset: ${scenario.presetName}`,
    `Task: ${scenario.userPrompt}`,
    `Step: ${step.id}`,
    `Agent: ${step.agentKey}`,
    `Output key: ${step.outputKey}`,
    `Expected outcome: ${scenario.expectedOutcome}`,
    "Success criteria:",
    ...scenario.successCriteria.map((criterion) => `- ${criterion}`),
    outputs.length > 0 ? "Previous outputs were incorporated." : "No previous outputs were required.",
  ].join("\n");
}

function buildFinalArtifact(
  scenario: BuiltInPresetE2ETaskScenario,
  steps: readonly PresetE2ETaskStepResult[],
): string {
  return [
    `Preset E2E result: ${scenario.presetName}`,
    `Scenario: ${scenario.id}`,
    `Task: ${scenario.userPrompt}`,
    `Expected outcome: ${scenario.expectedOutcome}`,
    "Completed workflow steps:",
    ...steps.map((step) => `- ${step.stepId} via Agent(${step.sdkAgentKey}) -> ${step.outputKey}`),
    "Acceptance coverage:",
    ...scenario.successCriteria.map((criterion) => `- ${criterion}`),
    "Final answer:",
    `This deterministic E2E artifact satisfies ${scenario.expectedOutcome}.`,
  ].join("\n");
}

function validateFinalArtifact(
  scenario: BuiltInPresetE2ETaskScenario,
  artifact: string,
  steps: readonly PresetE2ETaskStepResult[],
): string[] {
  const errors: string[] = [];
  if (!artifact.includes(scenario.expectedOutcome)) {
    errors.push(`Final artifact is missing expected outcome: ${scenario.expectedOutcome}`);
  }
  for (const criterion of scenario.successCriteria) {
    if (!artifact.includes(criterion)) {
      errors.push(`Final artifact is missing success criterion: ${criterion}`);
    }
  }
  for (const agentKey of scenario.expectedAgentKeys) {
    if (!steps.some((step) => step.agentKey === agentKey)) {
      errors.push(`Expected E2E agent did not produce a step output: ${agentKey}`);
    }
  }
  if (steps.length === 0) {
    errors.push("E2E task produced no workflow steps.");
  }
  for (const step of steps) {
    if (!step.prompt.trim()) {
      errors.push(`Step prompt is empty: ${step.stepId}`);
    }
    if (!step.output.includes(step.outputKey)) {
      errors.push(`Step output does not mention output key: ${step.stepId}`);
    }
  }
  return errors;
}

function collectStrategySteps(profile: OrchestrationProfile): WorkflowStep[] {
  if (profile.strategy.kind === "autonomous") {
    return [];
  }
  if (profile.strategy.kind === "fixed") {
    return [
      ...profile.strategy.steps,
      ...(profile.strategy.finalAggregator ? [profile.strategy.finalAggregator] : []),
    ];
  }
  return [...profile.strategy.recommendedSteps];
}

function stringifySystemPrompt(systemPrompt: string | Record<string, unknown>): string {
  return typeof systemPrompt === "string" ? systemPrompt : JSON.stringify(systemPrompt);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
