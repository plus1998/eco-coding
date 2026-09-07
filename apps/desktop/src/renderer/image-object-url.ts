/** Create and revoke blob: object URLs for image bytes held in the renderer. */

export function createImageObjectUrlFromBase64(mimeType: string, dataBase64: string): string {
  const bytes = base64ToUint8Array(dataBase64);
  const copy = Uint8Array.from(bytes);
  const blob = new Blob([copy], { type: mimeType || "application/octet-stream" });
  return URL.createObjectURL(blob);
}

export function createImageObjectUrlFromBytes(
  mimeType: string,
  bytes: ArrayBuffer | Uint8Array,
): string {
  const copy = bytes instanceof Uint8Array ? Uint8Array.from(bytes) : new Uint8Array(bytes);
  const blob = new Blob([copy], { type: mimeType || "application/octet-stream" });
  return URL.createObjectURL(blob);
}

export function revokeImageObjectUrl(url: string | null | undefined): void {
  if (!url || !url.startsWith("blob:")) {
    return;
  }
  try {
    URL.revokeObjectURL(url);
  } catch {
    // Ignore double-revoke / already-gone URLs.
  }
}

export function revokeImageObjectUrls(urls: Iterable<string | null | undefined>): void {
  for (const url of urls) {
    revokeImageObjectUrl(url);
  }
}

function base64ToUint8Array(dataBase64: string): Uint8Array {
  const binary = atob(dataBase64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}
