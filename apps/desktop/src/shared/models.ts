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
  requestPath?: string;
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
