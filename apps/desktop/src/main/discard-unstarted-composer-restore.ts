import type { PromptImageAttachment } from "../shared/ipc";

/** Image-only turns store a placeholder prompt; restore the empty composer text instead. */
export function resolveRestorePromptText(rawPrompt: string, imageOnlyPrompt: string): string {
  return rawPrompt.trim() === imageOnlyPrompt ? "" : rawPrompt;
}

/**
 * After discarding the only user turn, `threads.prompt` must be cleared or the Feed
 * re-shows it via `showThreadPrompt`.
 */
export function shouldClearThreadPromptAfterUnstartedDiscard(
  remainingUserMessageCount: number,
): boolean {
  return remainingUserMessageCount <= 0;
}

/**
 * Composer restore needs inline `data` so the renderer can build preview URLs.
 * Message-persisted attachments are often path-only.
 */
export async function hydratePromptAttachmentsForComposerRestore(
  attachments: readonly PromptImageAttachment[],
  readData: (attachment: PromptImageAttachment) => Promise<string>,
): Promise<PromptImageAttachment[]> {
  const out: PromptImageAttachment[] = [];
  for (const attachment of attachments) {
    const inline = attachment.data?.trim();
    if (inline) {
      out.push({
        mediaType: attachment.mediaType,
        data: inline,
        ...(attachment.path?.trim() ? { path: attachment.path.trim() } : {}),
      });
      continue;
    }
    try {
      const data = (await readData(attachment)).trim();
      if (!data) {
        continue;
      }
      out.push({
        mediaType: attachment.mediaType,
        data,
        ...(attachment.path?.trim() ? { path: attachment.path.trim() } : {}),
      });
    } catch {
      // Skip unreadable attachments rather than failing the whole restore.
    }
  }
  return out;
}

/**
 * Draft spool staging must not reuse message-dir paths (those are deleted with the turn).
 * Pass data-only attachments into `normalizeComposerDraftAttachments`.
 */
export function toSpoolStageAttachments(
  hydrated: readonly PromptImageAttachment[],
): PromptImageAttachment[] {
  const out: PromptImageAttachment[] = [];
  for (const attachment of hydrated) {
    const data = attachment.data?.trim();
    if (!data) {
      continue;
    }
    out.push({ mediaType: attachment.mediaType, data });
  }
  return out;
}
