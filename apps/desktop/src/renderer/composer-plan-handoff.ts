export interface ComposerPlanHandoff {
  contextKey: string;
  prompt: string;
  sessionMode: "agent";
}

export interface ComposerContextPromptResolution {
  prompt: string;
  handoffConsumed: boolean;
  shouldLoadPersistedDraft: boolean;
  sessionMode?: "agent";
}

export function resolveComposerContextPrompt(
  contextKey: string | undefined,
  memoryDraftPrompt: string | undefined,
  handoff: ComposerPlanHandoff | undefined,
): ComposerContextPromptResolution {
  const matchingHandoff = contextKey && handoff?.contextKey === contextKey ? handoff : undefined;
  return {
    prompt: matchingHandoff?.prompt ?? memoryDraftPrompt ?? "",
    handoffConsumed: Boolean(matchingHandoff),
    shouldLoadPersistedDraft: !matchingHandoff && memoryDraftPrompt === undefined,
    ...(matchingHandoff?.sessionMode ? { sessionMode: matchingHandoff.sessionMode } : {}),
  };
}

export function resolveComposerPlanRuntimeConfig<T extends { sessionMode?: string }>(
  current: T | null,
  sessionMode: "agent" | undefined,
): (Omit<T, "sessionMode"> & { sessionMode: "agent" }) | null {
  if (!current || !sessionMode) {
    return current as (Omit<T, "sessionMode"> & { sessionMode: "agent" }) | null;
  }
  return { ...current, sessionMode } as Omit<T, "sessionMode"> & { sessionMode: "agent" };
}
