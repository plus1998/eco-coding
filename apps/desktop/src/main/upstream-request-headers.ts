import type { IncomingHttpHeaders } from "node:http";
import { isOpenAICompat, type UpstreamApiCompat } from "../shared/api-compat";
import { buildAnthropicHeaders, buildOpenAIHeaders } from "./provider-models";

const ANTHROPIC_VERSION = "2023-06-01";
export const DEFAULT_UPSTREAM_USER_AGENT = "Eco-Coding/0.0.0";

const PASSTHROUGH_HEADER_NAMES = ["accept", "anthropic-beta", "anthropic-version", "user-agent"] as const;

function readHeaderString(headers: IncomingHttpHeaders, name: string): string | undefined {
  const value = headers[name];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function applyUserAgent(
  headers: Record<string, string>,
  clientHeaders: IncomingHttpHeaders,
  upstreamUserAgent?: string,
): void {
  const override = upstreamUserAgent?.trim();
  if (override) {
    headers["user-agent"] = override;
    return;
  }
  const clientUa = readHeaderString(clientHeaders, "user-agent");
  if (clientUa) {
    headers["user-agent"] = clientUa;
    return;
  }
  headers["user-agent"] = DEFAULT_UPSTREAM_USER_AGENT;
}

/** Headers for proxy bridge → upstream (SDK client headers + optional global UA override). */
export function buildProxyUpstreamHeaders(input: {
  clientHeaders: IncomingHttpHeaders;
  apiKey: string;
  apiCompat: UpstreamApiCompat;
  upstreamUserAgent?: string;
}): Record<string, string> {
  const { clientHeaders, apiKey, apiCompat, upstreamUserAgent } = input;
  const isOpenAI = isOpenAICompat(apiCompat);
  const headers: Record<string, string> = {
    ...(isOpenAI ? buildOpenAIHeaders(apiKey) : buildAnthropicHeaders(apiKey)),
  };

  if (!isOpenAI) {
    for (const name of PASSTHROUGH_HEADER_NAMES) {
      const value = readHeaderString(clientHeaders, name);
      if (value) {
        headers[name] = value;
      }
    }
    if (!headers["anthropic-version"]) {
      headers["anthropic-version"] = ANTHROPIC_VERSION;
    }
  }

  const contentType = readHeaderString(clientHeaders, "content-type");
  if (contentType) {
    headers["content-type"] = contentType;
  } else if (!headers["content-type"]) {
    headers["content-type"] = "application/json";
  }

  applyUserAgent(headers, clientHeaders, upstreamUserAgent);
  return headers;
}

/** Headers for provider test / model list (no SDK client); identifies as Eco unless overridden. */
export function buildProviderDirectUpstreamHeaders(input: {
  apiKey: string;
  apiCompat: UpstreamApiCompat;
  upstreamUserAgent?: string;
}): Record<string, string> {
  const headers = buildProxyUpstreamHeaders({
    clientHeaders: {},
    apiKey: input.apiKey,
    apiCompat: input.apiCompat,
    ...(input.upstreamUserAgent && { upstreamUserAgent: input.upstreamUserAgent }),
  });
  headers["content-type"] = "application/json";
  return headers;
}

/** Convert plain header map to fetch `Headers` (anthropic-proxy). */
export function proxyUpstreamHeadersToFetch(headers: Record<string, string>): Headers {
  const fetchHeaders = new Headers();
  for (const [name, value] of Object.entries(headers)) {
    fetchHeaders.set(name, value);
  }
  return fetchHeaders;
}
