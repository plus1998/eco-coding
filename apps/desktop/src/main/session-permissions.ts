/** Origins allowed to use privileged web APIs in the Eco desktop renderer. */
export function isLocalRendererUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "file:" || parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost";
  } catch {
    return false;
  }
}

/**
 * Session permission gate for the default app window.
 * ASR needs media/audio; in-app copy uses clipboard-sanitized-write.
 */
export function isAllowedSessionPermission(
  localRenderer: boolean,
  permission: string,
  mediaTypes?: readonly string[],
): boolean {
  if (!localRenderer) {
    return false;
  }
  if (permission === "clipboard-sanitized-write") {
    return true;
  }
  if (permission === "media") {
    return Boolean(mediaTypes?.includes("audio")) && !mediaTypes?.includes("video");
  }
  return false;
}
