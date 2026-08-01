export const MAX_ASR_DATA_URL_BYTES = 10 * 1024 * 1024;
export const ASR_WAV_DATA_URL_PREFIX = "data:audio/wav;base64,";

export function asrDataUrlByteLength(base64: string): number {
  return new TextEncoder().encode(`${ASR_WAV_DATA_URL_PREFIX}${base64}`).byteLength;
}
