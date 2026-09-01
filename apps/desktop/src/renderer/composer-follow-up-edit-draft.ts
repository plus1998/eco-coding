export interface ComposerFollowUpEditSnapshot {
  prompt: string;
  attachments: readonly unknown[];
  rewindTarget?: unknown;
  imageNotice?: string;
}

export function captureComposerBeforeFollowUpEdit(input: {
  alreadyEditing: boolean;
  prompt: string;
  attachments: readonly unknown[];
  rewindTarget?: unknown;
  imageNotice?: string;
}): ComposerFollowUpEditSnapshot | undefined {
  if (input.alreadyEditing) {
    return undefined;
  }
  return {
    prompt: input.prompt,
    attachments: [...input.attachments],
    ...(input.rewindTarget ? { rewindTarget: input.rewindTarget } : {}),
    ...(input.imageNotice ? { imageNotice: input.imageNotice } : {}),
  };
}

export function resolveComposerAfterFollowUpEdit(saved: ComposerFollowUpEditSnapshot | undefined): {
  prompt: string;
  attachments: unknown[];
  rewindTarget?: unknown;
  imageNotice?: string;
} {
  if (!saved) {
    return { prompt: "", attachments: [] };
  }
  return {
    prompt: saved.prompt,
    attachments: [...saved.attachments],
    ...(saved.rewindTarget ? { rewindTarget: saved.rewindTarget } : {}),
    ...(saved.imageNotice ? { imageNotice: saved.imageNotice } : {}),
  };
}
