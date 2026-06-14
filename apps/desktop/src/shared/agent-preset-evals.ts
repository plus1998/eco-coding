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

export interface BuiltInPresetEvalScenario {
  id: string;
  presetId: OrchestrationProfile["preset"];
  presetName: string;
  evalTitle: string;
  userPrompt: string;
  successCriteria: string[];
  expectedAgentKeys: string[];
  profile: OrchestrationProfile;
}

export interface PresetEvalValidationResult {
  scenarioId: string;
  ok: boolean;
  errors: string[];
}

export interface PresetCommercialQualityGateResult {
  scenarioId: string;
  presetId: OrchestrationProfile["preset"];
  ok: boolean;
  errors: string[];
  runtimeAgentKeys: string[];
}

export interface PresetCommercialQualityGateReport {
  ok: boolean;
  scenarioCount: number;
  presetIds: OrchestrationProfile["preset"][];
  runtimeAgentCount: number;
  results: PresetCommercialQualityGateResult[];
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
      expectedAgentKeys: [...evalCase.expectedAgentKeys],
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
  for (const agentKey of scenario.expectedAgentKeys) {
    if (!enabledAgentKeys.has(agentKey)) {
      errors.push(`Expected agent is not enabled: ${agentKey}`);
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

export function validateBuiltInPresetCommercialQualityGateScenario(
  scenario: BuiltInPresetEvalScenario,
  templates: readonly AgentTemplate[] = createBuiltInAgentTemplates(),
): PresetCommercialQualityGateResult {
  const errors = [...validateBuiltInPresetEvalScenario(scenario).errors];
  const enabledAgents = scenario.profile.agents.filter((agent) => agent.enabled);
  const enabledAgentKeys = new Set(enabledAgents.map((agent) => agent.agentKey));
  const runtimeAgentKeys: string[] = [];

  let promptText = "";
  try {
    const systemPrompt = buildMainAgentSystemPrompt(scenario.profile, templates, "QUALITY_GATE_PHASE", {
      excludeDynamicSections: scenario.profile.preset === "coding",
    });
    promptText = stringifySystemPrompt(systemPrompt);
  } catch (caught) {
    errors.push(
      `Main agent prompt cannot be built: ${caught instanceof Error ? caught.message : String(caught)}`,
    );
  }

  try {
    const resolved = createAgentDefinitionsFromProfile(scenario.profile, templates);
    runtimeAgentKeys.push(...resolved.agentKeys);
    const expectedAgentKeys = enabledAgents.map((agent) => sdkAgentKeyForProfileAgent(agent.agentKey));
    for (const sdkKey of expectedAgentKeys) {
      if (!resolved.agentKeys.includes(sdkKey)) {
        errors.push(`Enabled agent is missing from runtime definitions: ${sdkKey}`);
      }
      if (!promptText.includes(`Agent(${sdkKey})`)) {
        errors.push(`Main agent roster is missing runtime agent: ${sdkKey}`);
      }
      const definition = resolved.definitions[sdkKey] as Record<string, unknown> | undefined;
      if (!definition) {
        continue;
      }
      if (typeof definition.model !== "string" || !definition.model.trim()) {
        errors.push(`Runtime agent has no model: ${sdkKey}`);
      }
      if (typeof definition.prompt !== "string" || !definition.prompt.trim()) {
        errors.push(`Runtime agent has no child prompt: ${sdkKey}`);
      }
    }
    if (resolved.agentKeys.length !== expectedAgentKeys.length) {
      errors.push(
        `Runtime definition count mismatch: expected ${expectedAgentKeys.length}, got ${resolved.agentKeys.length}`,
      );
    }
  } catch (caught) {
    errors.push(
      `Runtime agent definitions cannot be built: ${caught instanceof Error ? caught.message : String(caught)}`,
    );
  }

  try {
    const policy = buildToolPermissionPolicyFromProfile(scenario.profile, templates, {
      agentKeys: runtimeAgentKeys,
    });
    const agentBlocked = policy.main.disallowed.some(
      (pattern) => pattern === "Agent" || pattern.startsWith("Agent("),
    );
    if (enabledAgents.length > 0 && agentBlocked) {
      errors.push("Main agent must allow Agent tool when subagents are enabled.");
    }
    for (const sdkKey of runtimeAgentKeys) {
      if (!policy.agents[sdkKey]) {
        errors.push(`Runtime tool policy is missing agent: ${sdkKey}`);
      }
    }
  } catch (caught) {
    errors.push(
      `Runtime tool policy cannot be built: ${caught instanceof Error ? caught.message : String(caught)}`,
    );
  }

  for (const template of templates) {
    if (!enabledAgentKeys.has(templateIdToAgentKey(scenario.profile, template.id))) {
      continue;
    }
    const childPrompt = template.prompt.trim();
    if (childPrompt.length > 20 && promptText.includes(childPrompt)) {
      errors.push(`Main agent prompt leaks child prompt: ${template.id}`);
    }
  }

  return {
    scenarioId: scenario.id,
    presetId: scenario.presetId,
    ok: errors.length === 0,
    errors,
    runtimeAgentKeys,
  };
}

export function createBuiltInPresetCommercialQualityGateReport(
  scenarios: readonly BuiltInPresetEvalScenario[] = createBuiltInPresetEvalScenarios(),
  templates: readonly AgentTemplate[] = createBuiltInAgentTemplates(),
): PresetCommercialQualityGateReport {
  const results = scenarios.map((scenario) =>
    validateBuiltInPresetCommercialQualityGateScenario(scenario, templates),
  );
  return {
    ok: results.every((result) => result.ok),
    scenarioCount: scenarios.length,
    presetIds: [...new Set(scenarios.map((scenario) => scenario.presetId))],
    runtimeAgentCount: results.reduce((total, result) => total + result.runtimeAgentKeys.length, 0),
    results,
  };
}

function stringifySystemPrompt(systemPrompt: string | Record<string, unknown>): string {
  return typeof systemPrompt === "string" ? systemPrompt : JSON.stringify(systemPrompt);
}

function templateIdToAgentKey(profile: OrchestrationProfile, templateId: string): string {
  return profile.agents.find((agent) => agent.templateId === templateId && agent.enabled)?.agentKey ?? "";
}
