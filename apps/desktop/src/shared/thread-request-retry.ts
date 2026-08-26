/** Cores that can rewind a user turn and resend it (edit / rewrite UI). */
export function supportsHistoryRewrite(coreKind: string | undefined): boolean {
  return coreKind === "claude" || coreKind === "codex";
}

/**
 * One-click failure retry that rewinds history before resending.
 * Codex edit/rewrite still uses fork; one-click retry does not — it continues.
 */
export function usesRewindOnRequestRetry(coreKind: string | undefined): boolean {
  return coreKind === "claude";
}

/**
 * Cores that can one-click retry a failed request.
 * ACP/Codex: continue the same prompt without a second user bubble (no rewind).
 * Pi has no rewrite and no skip-record continue path — do not pretend it can retry.
 */
export function supportsOneClickRequestRetry(coreKind: string | undefined): boolean {
  return usesRewindOnRequestRetry(coreKind) || coreKind === "acp" || coreKind === "codex";
}

/**
 * Simple continue retry cannot target older turns (no fork).
 * Codex additionally requires the failed turn to have produced no agent progress.
 */
export function usesLatestTurnOnlyRequestRetry(coreKind: string | undefined): boolean {
  return coreKind === "acp" || coreKind === "codex";
}

/** Codex one-click retry is only for early provider failures before agent work. */
export function requiresEmptyTurnForRequestRetry(coreKind: string | undefined): boolean {
  return coreKind === "codex";
}
