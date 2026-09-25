export interface ComposerPlanHandoff {
  contextKey: string;
  prompt: string;
}

export interface ComposerContextPromptResolution {
  prompt: string;
  handoffConsumed: boolean;
  shouldLoadPersistedDraft: boolean;
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
  };
}
