/** Reads the teaching switch from persisted config (supports legacy `v4aCorrectionEnabled`). */
export function isV4aTeachingEnabled(
  config: { v4aTeachingEnabled?: boolean; v4aCorrectionEnabled?: boolean } | undefined,
): boolean {
  return config?.v4aTeachingEnabled === true || config?.v4aCorrectionEnabled === true;
}
