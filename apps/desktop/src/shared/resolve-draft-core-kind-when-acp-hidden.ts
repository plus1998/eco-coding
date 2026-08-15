import type { CoreKind } from "@eco/runtime/core-runtime";

/**
 * Demote cold-start / new-thread draft `acp` when Cursor·ACP UI is truly hidden.
 * Returns `undefined` when the draft should stay unchanged.
 *
 * Do not demote solely because `coreAvailability` probe has not returned yet while
 * `acpAgentsEnabled.cursor === true` (cold-start race).
 */
export function resolveDraftCoreKindWhenAcpHidden(input: {
  draftCoreKind: CoreKind;
  /** Mirrors `workflowSettings.acpAgentsEnabled?.cursor === true`. */
  acpCursorEnabled: boolean;
  /** True once `coreAvailability` snapshot has been set (probe returned). */
  coreAvailabilityResolved: boolean;
  /** True when ACP Cursor is shown: enabled ∧ cursor.available. */
  showAcpCursor: boolean;
  /** True while selecting Cursor is probing / enabling; do not demote mid-flight. */
  selectionInFlight?: boolean;
  defaultCoreKind?: CoreKind | null;
}): CoreKind | undefined {
  if (input.draftCoreKind !== "acp" || input.showAcpCursor || input.selectionInFlight) {
    return undefined;
  }
  if (input.acpCursorEnabled && !input.coreAvailabilityResolved) {
    return undefined;
  }
  const fallback = input.defaultCoreKind;
  return !fallback || fallback === "acp" ? "claude" : fallback;
}
