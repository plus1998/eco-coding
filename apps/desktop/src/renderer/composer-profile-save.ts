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
    updatedAt: new Date().toISOString(),
    agents,
    strategy: structuredClone(copy.strategy) as OrchestrationProfile["strategy"],
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
