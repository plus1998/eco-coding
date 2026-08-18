import type { CoreKind } from "@eco/runtime/core-runtime";

/**
 * Demote cold-start / new-thread draft `acp` when Cursor·ACP UI is truly hidden.
 * Returns `undefined` when the draft should stay unchanged.
 *
 * Availability is CLI probe–driven (`showAcpCursor`); do not demote while the
 * probe is still pending (cold-start race).
 */
export function resolveDraftCoreKindWhenAcpHidden(input: {
  draftCoreKind: CoreKind;
  /** @deprecated Ignored; kept for call-site compatibility. */
  acpCursorEnabled?: boolean;
  /** True once `coreAvailability` snapshot has been set (probe returned). */
  coreAvailabilityResolved: boolean;
  /** True when Cursor ACP probe reports available. */
  showAcpCursor: boolean;
  /** True while selecting Cursor is probing / enabling; do not demote mid-flight. */
  selectionInFlight?: boolean;
  defaultCoreKind?: CoreKind | null;
}): CoreKind | undefined {
  if (input.draftCoreKind !== "acp" || input.showAcpCursor || input.selectionInFlight) {
    return undefined;
  }
  if (!input.coreAvailabilityResolved) {
    return undefined;
  }
  const fallback = input.defaultCoreKind;
  return !fallback || fallback === "acp" ? "claude" : fallback;
}
