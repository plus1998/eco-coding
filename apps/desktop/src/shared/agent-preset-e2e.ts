import {
  buildMainAgentSystemPrompt,
  buildToolPermissionPolicyFromProfile,
  createAgentDefinitionsFromProfile,
  sdkAgentKeyForProfileAgent,
} from "@eco/runtime";
import type { AgentTemplate, ModelRef, OrchestrationProfile } from "./agent-orchestration";
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

export interface PresetE2ETaskAgentResult {
  agentKey: string;
  sdkAgentKey: string;
  resultKey: string;
  prompt: string;
  output: string;
  sequence: number;
}

export interface PresetE2ETaskRunResult {
  scenarioId: string;
  presetId: OrchestrationProfile["preset"];
  ok: boolean;
  errors: string[];
  runtimeAgentKeys: string[];
  strategyKind: OrchestrationProfile["strategy"]["kind"];
  agentResults: PresetE2ETaskAgentResult[];
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
  const agentResults: PresetE2ETaskAgentResult[] = [];

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

  try {
    agentResults.push(...runPresetAgentResults(scenario));
  } catch (caught) {
    errors.push(`Preset agent results cannot be simulated: ${errorMessage(caught)}`);
  }

  const finalArtifact = buildFinalArtifact(scenario, agentResults);
  errors.push(...validateFinalArtifact(scenario, finalArtifact, agentResults));

  return {
    scenarioId: scenario.id,
    presetId: scenario.presetId,
    ok: errors.length === 0,
    errors,
    runtimeAgentKeys,
    strategyKind: scenario.profile.strategy.kind,
    agentResults,
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

function runPresetAgentResults(scenario: BuiltInPresetE2ETaskScenario): PresetE2ETaskAgentResult[] {
  const agentKeys =
    scenario.expectedAgentKeys.length > 0
      ? scenario.expectedAgentKeys
      : scenario.profile.agents.filter((agent) => agent.enabled).map((agent) => agent.agentKey);
  if (agentKeys.length === 0) {
    throw new Error("E2E scenario has no enabled agent.");
  }
  return agentKeys.map((agentKey, index) =>
    buildAgentResult({
      scenario,
      agentKey,
      sequence: index,
    }),
  );
}

function buildAgentResult(input: {
  scenario: BuiltInPresetE2ETaskScenario;
  agentKey: string;
  sequence: number;
}): PresetE2ETaskAgentResult {
  const sdkAgentKey = sdkAgentKeyForProfileAgent(input.agentKey);
  const resultKey = `${input.agentKey}_result`;
  const prompt = [
    input.scenario.profile.strategy.guidancePrompt ?? "Choose agents based on the task.",
    `User task: ${input.scenario.userPrompt}`,
    `Consider Agent(${sdkAgentKey}) when it materially improves the result.`,
  ].join("\n\n");
  return {
    agentKey: input.agentKey,
    sdkAgentKey,
    resultKey,
    prompt,
    output: buildSimulatedAgentOutput(input.scenario, input.agentKey, resultKey),
    sequence: input.sequence,
  };
}

function buildSimulatedAgentOutput(
  scenario: BuiltInPresetE2ETaskScenario,
  agentKey: string,
  resultKey: string,
): string {
  return [
    `Preset: ${scenario.presetName}`,
    `Task: ${scenario.userPrompt}`,
    `Agent: ${agentKey}`,
    `Result key: ${resultKey}`,
    `Expected outcome: ${scenario.expectedOutcome}`,
    "Success criteria:",
    ...scenario.successCriteria.map((criterion) => `- ${criterion}`),
    "Main agent remains responsible for the final answer.",
  ].join("\n");
}

function buildFinalArtifact(
  scenario: BuiltInPresetE2ETaskScenario,
  agentResults: readonly PresetE2ETaskAgentResult[],
): string {
  return [
    `Preset E2E result: ${scenario.presetName}`,
    `Scenario: ${scenario.id}`,
    `Task: ${scenario.userPrompt}`,
    `Expected outcome: ${scenario.expectedOutcome}`,
    "Expected agent coverage:",
    ...agentResults.map(
      (result) => `- ${result.agentKey} via Agent(${result.sdkAgentKey}) -> ${result.resultKey}`,
    ),
    "Acceptance coverage:",
    ...scenario.successCriteria.map((criterion) => `- ${criterion}`),
    "Final answer:",
    `This deterministic E2E artifact satisfies ${scenario.expectedOutcome}.`,
  ].join("\n");
}

function validateFinalArtifact(
  scenario: BuiltInPresetE2ETaskScenario,
  artifact: string,
  agentResults: readonly PresetE2ETaskAgentResult[],
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
    if (!agentResults.some((result) => result.agentKey === agentKey)) {
      errors.push(`Expected E2E agent did not produce a result: ${agentKey}`);
    }
  }
  if (agentResults.length === 0) {
    errors.push("E2E task produced no agent results.");
  }
  for (const result of agentResults) {
    if (!result.prompt.trim()) {
      errors.push(`Agent prompt is empty: ${result.agentKey}`);
    }
    if (!result.output.includes(result.resultKey)) {
      errors.push(`Agent output does not mention result key: ${result.agentKey}`);
    }
  }
  return errors;
}

function stringifySystemPrompt(systemPrompt: string | Record<string, unknown>): string {
  return typeof systemPrompt === "string" ? systemPrompt : JSON.stringify(systemPrompt);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
