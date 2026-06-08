import type { OrchestrationProfile, ThreadRuntimeConfig } from "../shared/ipc";

export function buildComposerSavedProfile(input: {
  profile: OrchestrationProfile;
  runtimeConfig: ThreadRuntimeConfig;
  name: string;
  existingIds: readonly string[];
}): OrchestrationProfile {
  const copy = structuredClone(input.profile) as OrchestrationProfile;
  const { sourceRouteProfileId: _sourceRouteProfileId, ...withoutSourceRoute } = copy;
  const agents = copy.agents.map((agent) => {
    const runtimeEnabled = (input.runtimeConfig.subagentEnabled as Record<string, boolean | undefined>)[
      agent.agentKey
    ];
    return {
      ...agent,
      enabled: runtimeEnabled ?? agent.enabled,
    };
  });
  const name = input.name.trim();
  return {
    ...withoutSourceRoute,
    id: createUniqueComposerProfileId(name, input.existingIds),
    name,
    source: "user",
    version: 1,
    updatedAt: new Date().toISOString(),
    agents,
    strategy: buildComposerSavedStrategy(copy.strategy, input.runtimeConfig, agents),
  };
}

function buildComposerSavedStrategy(
  strategy: OrchestrationProfile["strategy"],
  runtimeConfig: ThreadRuntimeConfig,
  agents: readonly OrchestrationProfile["agents"][number][],
): OrchestrationProfile["strategy"] {
  if (runtimeConfig.orchestrationMode === "autonomous") {
    return {
      kind: "autonomous",
      ...(strategy.kind === "autonomous" && strategy.guidancePrompt
        ? { guidancePrompt: strategy.guidancePrompt }
        : {}),
    };
  }
  if (strategy.kind !== "autonomous") {
    return strategy;
  }
  const enabledAgents = agents.filter((agent) => agent.enabled);
  return {
    kind: "fixed",
    steps: enabledAgents.map((agent, index) => {
      const id = slugifyComposerProfileId(agent.agentKey) || `step_${index + 1}`;
      return {
        id,
        agentKey: agent.agentKey,
        promptTemplate: `Run ${agent.displayName || agent.agentKey}.`,
        dependsOn: index === 0 ? [] : [slugifyComposerProfileId(enabledAgents[index - 1]?.agentKey ?? "")],
        runMode: "sequential",
        required: true,
        outputKey: `${id}_output`,
        failurePolicy: index === 0 ? "stop" : "ask_user",
      };
    }),
  };
}

function createUniqueComposerProfileId(name: string, existingIds: readonly string[]): string {
  const base = `user.composer.${slugifyComposerProfileId(name) || "profile"}`;
  const existing = new Set(existingIds);
  let candidate = base;
  let suffix = 2;
  while (existing.has(candidate)) {
    candidate = `${base}_${suffix}`;
    suffix += 1;
  }
  return candidate;
}

function slugifyComposerProfileId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}
