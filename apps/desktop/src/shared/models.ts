export interface UpstreamModelOption {
  id: string;
  displayName?: string;
}

export interface CodexModelCatalogEntryView {
  id: string;
  model: string;
  displayName: string;
  defaultReasoningEffort: string;
  supportedReasoningEfforts: string[];
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

export type ProviderRequestErrorCode =
  | "provider_not_found"
  | "provider_base_url_missing"
  | "base_url_missing";

export interface ProviderRequestError {
  ok: false;
  error: string;
  errorCode?: ProviderRequestErrorCode;
  providerId?: string;
  providerName?: string;
}

export type ListUpstreamModelsResult =
  | { ok: true; models: UpstreamModelOption[] }
  | ProviderRequestError;

/** Thinking effort sent on connectivity tests (always disabled). */
export const ROUTE_TEST_THINKING_EFFORT = "off" as const;

export interface TestProviderConnectionRequest {
  providerId?: string;
  baseUrl?: string;
  requestPath?: string;
  apiCompat?: UpstreamApiCompat;
  apiKey?: string;
  defaultModel?: string;
  thinkingEffort?: typeof ROUTE_TEST_THINKING_EFFORT;
}

export type TestProviderConnectionResult =
  | { ok: true; reply: string }
  | ProviderRequestError;

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
