import { asrDataUrlByteLength, ASR_WAV_DATA_URL_PREFIX, MAX_ASR_DATA_URL_BYTES } from "../shared/asr-limits";

const MAX_ASR_SECONDS = 180;
const MAX_ASR_RAW_BYTES = Math.floor((MAX_ASR_DATA_URL_BYTES - ASR_WAV_DATA_URL_PREFIX.length) * 3 / 4);

export function downsampleToMono16k(audio: AudioBuffer): Float32Array {
  const ratio = audio.sampleRate / 16_000;
  const length = Math.floor(audio.length / ratio);
  const output = new Float32Array(length);
  for (let i = 0; i < length; i += 1) {
    const sourceIndex = Math.floor(i * ratio);
    let value = 0;
    for (let channel = 0; channel < audio.numberOfChannels; channel += 1) {
      value += audio.getChannelData(channel)[sourceIndex] ?? 0;
    }
    output[i] = value / audio.numberOfChannels;
  }
  return output;
}

export function encodePcm16Wav(samples: Float32Array, sampleRate = 16_000): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const write = (offset: number, value: string) => [...value].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)));
  write(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, "data");
  view.setUint32(40, samples.length * 2, true);
  samples.forEach((sample, index) => {
    const clamped = Math.max(-1, Math.min(1, sample));
    view.setInt16(44 + index * 2, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
  });
  return buffer;
}

export function wavToBase64(buffer: ArrayBuffer): string {
  if (buffer.byteLength > MAX_ASR_RAW_BYTES) {
    throw new Error("录音超过 10 MB 限制。");
  }
  const bytes = new Uint8Array(buffer);
  const parts: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    parts.push(String.fromCharCode(...bytes.subarray(offset, offset + 0x8000)));
  }
  const base64 = btoa(parts.join(""));
  if (asrDataUrlByteLength(base64) > MAX_ASR_DATA_URL_BYTES) {
    throw new Error("录音超过 10 MB 限制。");
  }
  return base64;
}

export { MAX_ASR_DATA_URL_BYTES, MAX_ASR_RAW_BYTES, MAX_ASR_SECONDS };
