import type { ModelRef, OrchestrationProfile, OrchestrationStrategy } from "./agent-orchestration";
import {
  buildOrchestrationProfileFromPreset,
  createBuiltInAgentTemplates,
  createBuiltInPresetCatalog,
} from "./agent-orchestration";

export interface BuiltInPresetEvalScenario {
  id: string;
  presetId: OrchestrationProfile["preset"];
  presetName: string;
  evalTitle: string;
  userPrompt: string;
  successCriteria: string[];
  requiredAgentKeys: string[];
  profile: OrchestrationProfile;
}

export interface PresetEvalValidationResult {
  scenarioId: string;
  ok: boolean;
  errors: string[];
}

const PRESET_EVAL_MODEL_REF: ModelRef = {
  providerId: "eval-provider",
  modelId: "eval-model",
  apiCompat: "anthropic",
};

const NON_CODING_PROMPT_FORBIDDEN_TERMS = [
  "software engineering",
  "repository",
  "code review",
  "unit test",
  "diff",
];

export function createBuiltInPresetEvalScenarios(
  modelRef: ModelRef = PRESET_EVAL_MODEL_REF,
): BuiltInPresetEvalScenario[] {
  const templates = createBuiltInAgentTemplates();
  return createBuiltInPresetCatalog().flatMap((preset) =>
    preset.evals.map((evalCase) => ({
      id: `${preset.id}.${evalCase.id}`,
      presetId: preset.id,
      presetName: preset.name,
      evalTitle: evalCase.title,
      userPrompt: evalCase.prompt,
      successCriteria: [...evalCase.successCriteria],
      requiredAgentKeys: [...evalCase.requiredAgentKeys],
      profile: buildOrchestrationProfileFromPreset(preset, {
        id: `eval.${preset.id}.${evalCase.id}`,
        name: `${preset.name} Eval - ${evalCase.title}`,
        modelRef,
        templates,
        source: "project",
        updatedAt: "2026-06-07T00:00:00.000Z",
      }),
    })),
  );
}

export function validateBuiltInPresetEvalScenario(
  scenario: BuiltInPresetEvalScenario,
): PresetEvalValidationResult {
  const errors: string[] = [];
  const enabledAgentKeys = new Set(
    scenario.profile.agents.filter((agent) => agent.enabled).map((agent) => agent.agentKey),
  );
  for (const agentKey of scenario.requiredAgentKeys) {
    if (!enabledAgentKeys.has(agentKey)) {
      errors.push(`Required agent is not enabled: ${agentKey}`);
    }
  }
  for (const agentKey of collectStrategyAgentKeys(scenario.profile.strategy)) {
    if (!enabledAgentKeys.has(agentKey)) {
      errors.push(`Workflow references a disabled or missing agent: ${agentKey}`);
    }
  }
  if (!scenario.profile.mainAgent.modelRef.providerId || !scenario.profile.mainAgent.modelRef.modelId) {
    errors.push("Main agent model is incomplete.");
  }
  for (const agent of scenario.profile.agents) {
    if (!agent.modelRef.providerId || !agent.modelRef.modelId) {
      errors.push(`Agent model is incomplete: ${agent.agentKey}`);
    }
  }
  if (scenario.successCriteria.length < 3) {
    errors.push("Eval case must define at least three success criteria.");
  }
  if (!scenario.userPrompt.trim()) {
    errors.push("Eval case prompt cannot be empty.");
  }
  if (scenario.presetId !== "coding") {
    const prompt = scenario.profile.mainAgent.prompt.toLowerCase();
    for (const term of NON_CODING_PROMPT_FORBIDDEN_TERMS) {
      if (prompt.includes(term)) {
        errors.push(`Non-coding main prompt contains coding-only term: ${term}`);
      }
    }
  }
  return {
    scenarioId: scenario.id,
    ok: errors.length === 0,
    errors,
  };
}

export function validateBuiltInPresetEvalSuite(
  scenarios: readonly BuiltInPresetEvalScenario[] = createBuiltInPresetEvalScenarios(),
): PresetEvalValidationResult[] {
  return scenarios.map((scenario) => validateBuiltInPresetEvalScenario(scenario));
}

function collectStrategyAgentKeys(strategy: OrchestrationStrategy): Set<string> {
  const keys = new Set<string>();
  if (strategy.kind === "autonomous") {
    return keys;
  }
  const steps = strategy.kind === "fixed" ? strategy.steps : strategy.recommendedSteps;
  for (const step of steps) {
    keys.add(step.agentKey);
  }
  if (strategy.kind === "fixed" && strategy.finalAggregator) {
    keys.add(strategy.finalAggregator.agentKey);
  }
  return keys;
}
