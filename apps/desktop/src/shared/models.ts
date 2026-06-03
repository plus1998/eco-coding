export interface UpstreamModelOption {
  id: string;
  displayName?: string;
}

import type { UpstreamApiCompat } from "./api-compat";

export interface ListUpstreamModelsRequest {
  providerId?: string;
  baseUrl?: string;
  /** Service path prefix, e.g. `/zen` or `/anthropic` (not full `/v1/chat/completions`). */
  requestPath?: string;
  apiCompat?: UpstreamApiCompat;
  apiKey?: string;
}

export type ListUpstreamModelsResult =
  | { ok: true; models: UpstreamModelOption[] }
  | { ok: false; error: string };

export interface TestProviderConnectionRequest {
  providerId?: string;
  baseUrl?: string;
  requestPath?: string;
  apiCompat?: UpstreamApiCompat;
  apiKey?: string;
  defaultModel?: string;
}

export type TestProviderConnectionResult =
  | { ok: true; reply: string }
  | { ok: false; error: string };

export interface TestRoleRouteItem {
  role: string;
  providerId: string;
  modelId: string;
  apiCompat?: UpstreamApiCompat;
  thinkingEffort?: string;
}

export interface RoleRouteTestResult {
  role: string;
  modelId: string;
  ok: boolean;
  error?: string;
  reply?: string;
  elapsedMs?: number;
}

export interface TestRoleRoutesRequest {
  routes: TestRoleRouteItem[];
}

export interface TestRoleRoutesResult {
  results: RoleRouteTestResult[];
  passed: number;
  failed: number;
}
