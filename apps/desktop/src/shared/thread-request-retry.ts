/** Cores that can rewind a user turn and resend it. */
export function supportsHistoryRewrite(coreKind: string | undefined): boolean {
  return coreKind === "claude" || coreKind === "codex";
}

/**
 * Cores that can one-click retry a failed request.
 * ACP cannot rewind; retry continues the same prompt without a second user bubble.
 * Pi has no rewrite and no skip-record continue path — do not pretend it can retry.
 */
export function supportsOneClickRequestRetry(coreKind: string | undefined): boolean {
  return supportsHistoryRewrite(coreKind) || coreKind === "acp";
}
