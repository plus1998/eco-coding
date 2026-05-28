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
