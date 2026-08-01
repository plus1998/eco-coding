import { normalizeAsrEndpoint, type AsrClientConfig } from "./asr-settings-store";
import { asrDataUrlByteLength, ASR_WAV_DATA_URL_PREFIX, MAX_ASR_DATA_URL_BYTES } from "../shared/asr-limits";

export interface AsrTranscribeRequest {
  audioWavBase64: string;
}

export interface AsrTranscribeResult {
  text: string;
}

export const DEFAULT_ASR_TIMEOUT_MS = 4 * 60 * 1000;

export function buildAsrRequestBody(config: AsrClientConfig, audioWavBase64: string): Record<string, unknown> {
  return {
    model: config.model,
    messages: [
      ...(config.systemPrompt
        ? [{ role: "system", content: config.systemPrompt }]
        : []),
      {
        role: "user",
        content: [
          {
            type: "input_audio",
            input_audio: { data: `${ASR_WAV_DATA_URL_PREFIX}${audioWavBase64}`, format: "wav" },
          },
        ],
      },
    ],
    stream: false,
    asr_options: { enable_itn: false },
  };
}

export async function transcribeAsr(
  config: AsrClientConfig,
  request: AsrTranscribeRequest,
  options: { fetch?: typeof fetch; timeoutMs?: number } = {},
): Promise<AsrTranscribeResult> {
  if (
    !request.audioWavBase64 ||
    asrDataUrlByteLength(request.audioWavBase64) > MAX_ASR_DATA_URL_BYTES ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(request.audioWavBase64)
  ) {
    throw new Error("录音数据无效。");
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_ASR_TIMEOUT_MS);
  try {
    const response = await (options.fetch ?? fetch)(
      `${normalizeAsrEndpoint(config.endpoint)}/chat/completions`,
      {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${config.apiKey}` },
        body: JSON.stringify(buildAsrRequestBody(config, request.audioWavBase64)),
        signal: controller.signal,
      },
    );
    const payload = (await response.json().catch(() => undefined)) as Record<string, unknown> | undefined;
    if (!response.ok) {
      const apiMessage =
        payload && typeof payload.error === "object" && payload.error
          ? (payload.error as Record<string, unknown>).message
          : undefined;
      throw new Error(typeof apiMessage === "string" ? `ASR API 错误：${apiMessage}` : `ASR 请求失败（HTTP ${response.status}）。`);
    }
    const choices = payload?.choices;
    const content =
      Array.isArray(choices) &&
      choices[0] &&
      typeof choices[0] === "object" &&
      (choices[0] as Record<string, unknown>).message &&
      typeof (choices[0] as Record<string, unknown>).message === "object"
        ? ((choices[0] as Record<string, unknown>).message as Record<string, unknown>).content
        : undefined;
    const normalizedContent = Array.isArray(content)
      ? content
          .filter((part): part is Record<string, unknown> => Boolean(part) && typeof part === "object")
          .map((part) => (typeof part.text === "string" ? part.text : ""))
          .join("")
      : typeof content === "string"
        ? content
        : typeof payload?.output_text === "string"
          ? payload.output_text
          : "";
    if (!normalizedContent.trim()) {
      throw new Error("ASR 返回为空或格式无效。");
    }
    return { text: normalizedContent.trim() };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("ASR 请求超时。");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
