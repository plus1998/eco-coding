import type { ProviderConfigInput } from "../shared/ipc";

export interface ProviderPresetDefinition {
  id: string;
  name: string;
  baseUrl: string;
  requestPath: string;
  apiCompat: NonNullable<ProviderConfigInput["apiCompat"]>;
  defaultModel: string;
  apiKeyUrl: string;
  badge?: string;
}

export const FREE_TOKEN_PROVIDER_PRESETS: ProviderPresetDefinition[] = [
  {
    id: "opencode-zen-free",
    name: "OpenCode Zen",
    baseUrl: "https://opencode.ai",
    requestPath: "/zen",
    apiCompat: "openai_chat_completions",
    defaultModel: "deepseek-v4-flash-free",
    apiKeyUrl: "https://opencode.ai/",
    badge: "Free",
  },
  {
    id: "nvidia-nim-free",
    name: "NVIDIA NIM",
    baseUrl: "https://integrate.api.nvidia.com",
    requestPath: "",
    apiCompat: "openai_chat_completions",
    defaultModel: "qwen/qwen3-coder-480b-a35b-instruct",
    apiKeyUrl: "https://build.nvidia.com/settings/api-keys",
    badge: "Free",
  },
  {
    id: "groq-free",
    name: "GroqCloud",
    baseUrl: "https://api.groq.com/openai",
    requestPath: "",
    apiCompat: "openai_chat_completions",
    defaultModel: "qwen/qwen3-32b",
    apiKeyUrl: "https://console.groq.com/keys",
    badge: "Free",
  },
  {
    id: "cerebras-free",
    name: "Cerebras Inference",
    baseUrl: "https://api.cerebras.ai",
    requestPath: "",
    apiCompat: "openai_chat_completions",
    defaultModel: "gpt-oss-120b",
    apiKeyUrl: "https://cloud.cerebras.ai",
    badge: "Free",
  },
  {
    id: "openrouter-free",
    name: "OpenRouter Free",
    baseUrl: "https://openrouter.ai/api",
    requestPath: "",
    apiCompat: "openai_chat_completions",
    defaultModel: "openrouter/free",
    apiKeyUrl: "https://openrouter.ai/settings/keys",
    badge: "Free",
  },
];

export function formatProviderPresetSelectLabel(preset: ProviderPresetDefinition): string {
  return preset.badge ? `${preset.name} · ${preset.badge}` : preset.name;
}

export function applyProviderPreset(
  form: ProviderConfigInput,
  preset: ProviderPresetDefinition,
): ProviderConfigInput {
  return {
    ...form,
    name: preset.name,
    baseUrl: preset.baseUrl,
    requestPath: preset.requestPath,
    apiCompat: preset.apiCompat,
    defaultModel: preset.defaultModel,
    enabled: true,
  };
}

export function findMatchingProviderPreset(
  form: Pick<ProviderConfigInput, "baseUrl" | "requestPath" | "apiCompat" | "defaultModel">,
): ProviderPresetDefinition | undefined {
  const baseUrl = normalizeComparable(form.baseUrl);
  const requestPath = normalizeRequestPathForCompare(form.requestPath);
  const apiCompat = form.apiCompat ?? "anthropic";
  const defaultModel = form.defaultModel.trim();

  return FREE_TOKEN_PROVIDER_PRESETS.find(
    (preset) =>
      normalizeComparable(preset.baseUrl) === baseUrl &&
      normalizeRequestPathForCompare(preset.requestPath) === requestPath &&
      preset.apiCompat === apiCompat &&
      preset.defaultModel === defaultModel,
  );
}

function normalizeComparable(value: string | undefined): string {
  return (value ?? "").trim().replace(/\/+$/, "");
}

function normalizeRequestPathForCompare(value: string | undefined): string {
  const trimmed = (value ?? "").trim();
  if (!trimmed) {
    return "";
  }
  const withLeadingSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return withLeadingSlash.replace(/\/+$/, "");
}
