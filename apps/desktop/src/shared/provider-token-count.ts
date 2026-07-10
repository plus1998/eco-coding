export type ProviderTokenCountMode =
  | "local_heuristic"
  | "anthropic_messages"
  | "openai_responses"
  | "llama_tokenize";

export const PROVIDER_TOKEN_COUNT_MODES: readonly ProviderTokenCountMode[] = [
  "local_heuristic",
  "anthropic_messages",
  "openai_responses",
  "llama_tokenize",
];

export function normalizeProviderTokenCountMode(value: unknown): ProviderTokenCountMode {
  if (value === undefined || value === null || value === "") {
    return "local_heuristic";
  }
  if (PROVIDER_TOKEN_COUNT_MODES.includes(value as ProviderTokenCountMode)) {
    return value as ProviderTokenCountMode;
  }
  throw new Error(`无效的 Provider token 计数模式：${String(value)}`);
}
