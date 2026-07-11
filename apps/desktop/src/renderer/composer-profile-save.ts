import type { OrchestrationProfile, ThreadRuntimeConfig } from "../shared/ipc";
import { resolveMainAgentModelOverrideForProvider } from "../shared/thread-runtime-config";

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
  const override = resolveMainAgentModelOverrideForProvider(
    copy.mainAgent.modelRef.providerId,
    input.runtimeConfig.mainAgentModelOverride,
  );
  const sameMainModel =
    override &&
    copy.mainAgent.modelRef.providerId === override.providerId &&
    copy.mainAgent.modelRef.modelId === override.modelId;
  const mainAgent = override
    ? {
        ...copy.mainAgent,
        modelRef: {
          ...(sameMainModel ? copy.mainAgent.modelRef : {}),
          providerId: override.providerId,
          modelId: override.modelId,
          ...(override.thinkingEffort !== undefined ? { thinkingEffort: override.thinkingEffort } : {}),
          ...(override.candidateModelId ? { candidateModelId: override.candidateModelId } : {}),
        },
      }
    : copy.mainAgent;
  const name = input.name.trim();
  return {
    ...withoutSourceRoute,
    id: createUniqueComposerProfileId(name, input.existingIds),
    name,
    source: "user",
    updatedAt: new Date().toISOString(),
    mainAgent,
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
