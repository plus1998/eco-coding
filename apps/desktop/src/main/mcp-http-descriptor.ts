import type { CodexMcpServerForConfigSync } from "@eco/runtime";
import { mcpHttpUrl } from "./mcp-streamable-http";

/** Claude / PI / ACP HTTP MCP entry (url + headers). */
export function buildEcoHttpMcpSdkEntry(input: {
  url: string;
  headers: Record<string, string>;
}): Record<string, unknown> {
  return {
    type: "http",
    url: input.url,
    headers: { ...input.headers },
    alwaysLoad: true,
  };
}

export function buildEcoHttpCodexServer(input: {
  name: string;
  controlBaseUrl: string;
  controlSecretHeader: string;
  controlSecret: string;
  enabledTools?: string[];
  /** Extra headers (e.g. Authorization for thread-bound injection). */
  extraHeaders?: Record<string, string>;
  toolTimeoutSec?: number;
  startupTimeoutSec?: number;
}): CodexMcpServerForConfigSync {
  const headers: Record<string, string> = {
    [input.controlSecretHeader]: input.controlSecret,
    ...(input.extraHeaders ?? {}),
  };
  return {
    name: input.name,
    transport: "http",
    url: mcpHttpUrl(input.controlBaseUrl),
    httpHeaders: headers,
    ...(input.enabledTools ? { enabledTools: input.enabledTools } : {}),
    startupTimeoutSec: input.startupTimeoutSec ?? 60,
    ...(typeof input.toolTimeoutSec === "number" ? { toolTimeoutSec: input.toolTimeoutSec } : {}),
  };
}

export function buildEcoHttpInjection(input: {
  name: string;
  controlBaseUrl: string;
  controlSecretHeader: string;
  controlSecret: string;
  authToken: string;
  authHeaderName?: string;
  enabledTools?: string[];
  toolTimeoutSec?: number;
}): { sdkEntry: Record<string, unknown>; codexServer: CodexMcpServerForConfigSync } {
  const url = mcpHttpUrl(input.controlBaseUrl);
  const authHeaderName = input.authHeaderName ?? "Authorization";
  const headers: Record<string, string> = {
    [input.controlSecretHeader]: input.controlSecret,
    [authHeaderName]:
      authHeaderName.toLowerCase() === "authorization"
        ? `Bearer ${input.authToken}`
        : input.authToken,
  };
  return {
    sdkEntry: buildEcoHttpMcpSdkEntry({ url, headers }),
    codexServer: buildEcoHttpCodexServer({
      name: input.name,
      controlBaseUrl: input.controlBaseUrl,
      controlSecretHeader: input.controlSecretHeader,
      controlSecret: input.controlSecret,
      ...(input.enabledTools ? { enabledTools: input.enabledTools } : {}),
      extraHeaders: {
        [authHeaderName]:
          authHeaderName.toLowerCase() === "authorization"
            ? `Bearer ${input.authToken}`
            : input.authToken,
      },
      ...(typeof input.toolTimeoutSec === "number" ? { toolTimeoutSec: input.toolTimeoutSec } : {}),
    }),
  };
}
