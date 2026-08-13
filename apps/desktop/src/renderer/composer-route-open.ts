/** Decide whether empty orchestration chooser should open full settings vs readonly popover. */
export function shouldOpenOrchestrationFullSettings(input: {
  canEditComposerConfig: boolean;
  mainAgentConfigCount: number;
}): boolean {
  return input.mainAgentConfigCount === 0 && input.canEditComposerConfig;
}
