import { expect, test } from "bun:test";
import { buildAsrRequestBody, transcribeAsr } from "../src/main/asr-client";
import { ASR_MODEL, AsrSettingsStore, normalizeAsrEndpoint } from "../src/main/asr-settings-store";
import { encodePcm16Wav, wavToBase64 } from "../src/renderer/asr-audio";
import { mergeAsrTextAtSelection } from "../src/renderer/asr-composer";
import { reportAsrError, resolveAsrErrorMessage, shouldAnimateWaveform } from "../src/renderer/AsrRecorder";
import { resolveAsrLoadErrorDetail } from "../src/renderer/AsrSettingsPanel";
import { AsrSettingsPanel } from "../src/renderer/AsrSettingsPanel";
import { renderLocalized } from "./i18n-test";
import { createElement } from "react";
import { ASR_WAV_DATA_URL_PREFIX, MAX_ASR_DATA_URL_BYTES, asrDataUrlByteLength } from "../src/shared/asr-limits";
import { i18nCatalogs } from "../src/shared/i18n-catalogs";

test("starts waveform animation only for an active non-busy recording", () => {
  expect(shouldAnimateWaveform(true, false, false)).toBe(true);
  expect(shouldAnimateWaveform(false, false, false)).toBe(false);
  expect(shouldAnimateWaveform(true, true, false)).toBe(false);
  expect(shouldAnimateWaveform(true, false, true)).toBe(false);
});

test("reports the original ASR error message and falls back for unknown errors", () => {
  const messages: string[] = [];
  reportAsrError(messages.push.bind(messages), new Error("transcribe service unavailable"), "录音失败");
  reportAsrError(messages.push.bind(messages), { reason: "unknown" }, "录音失败");
  expect(messages).toEqual(["transcribe service unavailable", "录音失败"]);
  expect(resolveAsrErrorMessage(new Error(""), "录音失败")).toBe("录音失败");
});

test("contains all visible ASR settings catalog keys in both locales", () => {
  const zh = i18nCatalogs["zh-CN"].translation;
  const en = i18nCatalogs["en-US"].translation;
  for (const key of ["asr.baseUrl", "asr.loadError", "asr.loadErrorUnknown", "asr.saveError", "asr.savedMessage"]) {
    expect(zh[key]).toBeTruthy();
    expect(en[key]).toBeTruthy();
  }
});

test("renders an ASR settings load error detail or localized unknown fallback", () => {
  expect(resolveAsrLoadErrorDetail("database unavailable", "Unknown error")).toBe("database unavailable");
  expect(resolveAsrLoadErrorDetail("", "Unknown error")).toBe("Unknown error");
  expect(resolveAsrLoadErrorDetail(undefined, "Unknown error")).toBeUndefined();
});

test("renders the configured model as an editable field and disables it while busy", () => {
  const props = {
    snapshot: {
      endpoint: "https://example.com/v1",
      model: "custom-asr-model",
      systemPrompt: "",
      hasApiKey: false,
      apiKeyEncryptionAvailable: true,
    },
    onSave: async () => {},
  };
  const markup = renderLocalized(createElement(AsrSettingsPanel, props), "en-US");
  expect(markup).toContain('value="custom-asr-model"');
  expect(markup).not.toContain('value="custom-asr-model" readonly');
  const busyMarkup = renderLocalized(createElement(AsrSettingsPanel, { ...props, busy: true }), "en-US");
  expect(busyMarkup).toContain('disabled="" value="custom-asr-model"');
});

test("normalizes ASR base URLs and permits only local HTTP", () => {
  expect(normalizeAsrEndpoint("https://example.com/v1/chat/completions")).toBe("https://example.com/v1");
  expect(normalizeAsrEndpoint("https://example.com/v1/chat/completions?x=1#y")).toBe("https://example.com/v1");
  expect(normalizeAsrEndpoint("https://example.com/v1/chat/completions/chat/completions/")).toBe("https://example.com/v1");
  expect(normalizeAsrEndpoint("http://localhost:8080/v1")).toBe("http://localhost:8080/v1");
  expect(() => normalizeAsrEndpoint("http://example.com/v1")).toThrow();
});

test("merges ASR text once at the active composer selection", () => {
  expect(mergeAsrTextAtSelection("say hello", " world", 4, 9)).toEqual({
    prompt: "say  world",
    cursor: 10,
  });
});

/** Official Qwen ASR docs base64 sample prefix (Data URL example). */
const OFFICIAL_ASR_BASE64_SAMPLE =
  "SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4LjI5LjEwMAAAAAAAAAAAAAAA//PAxABQ/BXRbMPe4IQAhl9";

test("builds ASR chat completion body with official system content[{text}] shape", () => {
  const withPrompt = buildAsrRequestBody(
    { endpoint: "https://example.com/v1", model: "custom-asr-model", systemPrompt: "Names", apiKey: "secret" },
    OFFICIAL_ASR_BASE64_SAMPLE,
  );
  expect(withPrompt).toEqual({
    model: "custom-asr-model",
    messages: [
      { role: "system", content: [{ text: "Names" }] },
      {
        role: "user",
        content: [
          {
            type: "input_audio",
            input_audio: { data: `${ASR_WAV_DATA_URL_PREFIX}${OFFICIAL_ASR_BASE64_SAMPLE}` },
          },
        ],
      },
    ],
    stream: false,
    asr_options: { enable_itn: false },
  });

  const withoutPrompt = buildAsrRequestBody(
    { endpoint: "https://example.com/v1", model: "qwen3-asr-flash", systemPrompt: "", apiKey: "secret" },
    OFFICIAL_ASR_BASE64_SAMPLE,
  );
  expect(withoutPrompt.messages).toEqual([
    {
      role: "user",
      content: [
        {
          type: "input_audio",
          input_audio: { data: `${ASR_WAV_DATA_URL_PREFIX}${OFFICIAL_ASR_BASE64_SAMPLE}` },
        },
      ],
    },
  ]);
});

test("transcribeAsr posts system prompt as content[{text}] with official base64 sample", async () => {
  let body: Record<string, unknown> | undefined;
  const result = await transcribeAsr(
    {
      endpoint: "https://example.com/v1",
      model: "qwen3-asr-flash",
      systemPrompt: "热词：阿里云",
      apiKey: "secret",
    },
    { audioWavBase64: OFFICIAL_ASR_BASE64_SAMPLE },
    {
      fetch: async (_input, init) => {
        body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return new Response(JSON.stringify({ choices: [{ message: { content: "欢迎使用阿里云" } }] }), {
          status: 200,
        });
      },
    },
  );
  expect(result.text).toBe("欢迎使用阿里云");
  expect(body?.messages).toEqual([
    { role: "system", content: [{ text: "热词：阿里云" }] },
    {
      role: "user",
      content: [
        {
          type: "input_audio",
          input_audio: { data: `${ASR_WAV_DATA_URL_PREFIX}${OFFICIAL_ASR_BASE64_SAMPLE}` },
        },
      ],
    },
  ]);
});

test("parses ASR response and hides credentials from request assertions", async () => {
  let request: Request | undefined;
  const result = await transcribeAsr(
    { endpoint: "https://example.com/v1", model: "qwen3-asr-flash", systemPrompt: "", apiKey: "secret" },
    { audioWavBase64: "AQID" },
    {
      fetch: async (_input, init) => {
        request = new Request("https://example.com", init);
        return new Response(JSON.stringify({ choices: [{ message: { content: "你好" } }] }), { status: 200 });
      },
    },
  );
  expect(result.text).toBe("你好");
  expect(request?.headers.get("authorization")).toBe("Bearer secret");
});

test("rejects a Data URL at the 10 MB boundary in main", async () => {
  const maxValidBase64Length = MAX_ASR_DATA_URL_BYTES - ASR_WAV_DATA_URL_PREFIX.length - 2;
  const base64 = "A".repeat(maxValidBase64Length);
  expect(asrDataUrlByteLength(base64)).toBeLessThanOrEqual(MAX_ASR_DATA_URL_BYTES);
  await expect(
    transcribeAsr(
      { endpoint: "https://example.com/v1", model: "qwen3-asr-flash", systemPrompt: "", apiKey: "secret" },
      { audioWavBase64: `${base64}AAAA` },
      { fetch: async () => { throw new Error("fetch must not run"); } },
    ),
  ).rejects.toThrow("录音数据无效");
});

test("writes PCM16 mono WAV with a RIFF header", () => {
  const wav = encodePcm16Wav(new Float32Array([0, 1, -1]));
  expect(new TextDecoder().decode(wav.slice(0, 4))).toBe("RIFF");
  expect(wav.byteLength).toBe(50);
  expect(wavToBase64(wav)).toBeTruthy();
});

test("encrypts API keys before they reach SQLite and exposes decrypt errors", () => {
  let stored = "";
  const db = {
    exec() {},
    prepare() {
      return {
        get() {
          return stored ? { value_json: stored } : undefined;
        },
        run(_key: string, value: string) {
          stored = value;
        },
      };
    },
  } as never;
  const codec = {
    isAvailable: () => true,
    encrypt: (value: string) => `encrypted:${btoa(value)}`,
    decrypt: (value: string) => {
      if (!value.startsWith("encrypted:")) throw new Error("keychain unavailable");
      return atob(value.slice("encrypted:".length));
    },
  };
  const store = new AsrSettingsStore(db, codec);
  store.initialize();
  store.save({ endpoint: "", model: "custom-asr-model", systemPrompt: "", apiKey: "secret" });
  expect(stored).not.toContain("secret");
  expect(store.getClientConfig()?.apiKey).toBe("secret");

  stored = JSON.stringify({ endpoint: "", systemPrompt: "", apiKey: "plaintext" });
  expect(() => store.get()).toThrow("解密失败");
});

test("defaults the model for legacy settings and persists a custom model", () => {
  let stored = JSON.stringify({ endpoint: "", systemPrompt: "", apiKey: "" });
  const db = {
    exec() {},
    prepare() {
      return {
        get() {
          return { value_json: stored };
        },
        run(_key: string, value: string) {
          stored = value;
        },
      };
    },
  } as never;
  const store = new AsrSettingsStore(db);
  expect(store.get().model).toBe(ASR_MODEL);
  expect(store.getStatus().model).toBe(ASR_MODEL);
  expect(store.save({ endpoint: "", model: "  custom-asr-model  ", systemPrompt: "" }).model).toBe("custom-asr-model");
  expect(store.getStatus().model).toBe("custom-asr-model");
  expect(JSON.parse(stored).model).toBe("custom-asr-model");
  expect(store.getClientConfig()).toBeUndefined();
});

test("rejects an empty or overlong model", () => {
  const db = {
    exec() {},
    prepare() {
      return {
        get() {
          return undefined;
        },
        run() {},
      };
    },
  } as never;
  const store = new AsrSettingsStore(db);
  expect(() => store.save({ endpoint: "", model: "   ", systemPrompt: "" })).toThrow("ASR 模型不能为空");
  expect(() => store.save({ endpoint: "", model: "x".repeat(257), systemPrompt: "" })).toThrow("不能超过");
});
