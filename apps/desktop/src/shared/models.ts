export interface UpstreamModelOption {
  id: string;
  displayName?: string;
}

export interface ListUpstreamModelsRequest {
  providerId?: string;
  baseUrl?: string;
  apiKey?: string;
}

export type ListUpstreamModelsResult =
  | { ok: true; models: UpstreamModelOption[] }
  | { ok: false; error: string };

export interface TestProviderConnectionRequest {
  providerId?: string;
  baseUrl?: string;
  apiKey?: string;
  defaultModel?: string;
}

export type TestProviderConnectionResult =
  | { ok: true; reply: string }
  | { ok: false; error: string };
