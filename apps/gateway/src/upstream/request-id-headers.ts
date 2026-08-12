const UPSTREAM_REQUEST_ID_HEADERS = [
  "request-id",
  "x-request-id",
  "anthropic-request-id",
  "openai-request-id",
] as const;

/** Provider request id preserved when `request-id` is rewritten to ECO logical id. */
export const ECO_PROVIDER_REQUEST_ID_HEADER = "x-eco-provider-request-id";

export function readUpstreamRequestId(headers: Headers): string | undefined {
  for (const name of UPSTREAM_REQUEST_ID_HEADERS) {
    const value = headers.get(name)?.trim();
    if (value) {
      return value;
    }
  }
  return undefined;
}

/** Copy provider request-id headers onto a rebuilt Gateway Response. */
export function copyUpstreamRequestIdHeaders(from: Headers, to: Headers = new Headers()): Headers {
  for (const name of UPSTREAM_REQUEST_ID_HEADERS) {
    const value = from.get(name)?.trim();
    if (value && !to.has(name)) {
      to.set(name, value);
    }
  }
  return to;
}

export function headersWithUpstreamRequestId(upstream: Headers, init?: HeadersInit): Headers {
  return copyUpstreamRequestIdHeaders(upstream, new Headers(init));
}

/**
 * Build client-facing Gateway response headers.
 * When `logicalRequestId` is set, overwrite `request-id` so Claude Agent SDK
 * (`headers.get("request-id")` → `SDKAssistantMessage.request_id`) sees the ECO
 * logical identity. Provider id stays as independent metadata
 * (`x-eco-provider-request-id` + any non-overwritten upstream id headers).
 */
export function headersWithLogicalRequestIdentity(
  upstream: Headers,
  logicalRequestId: string | undefined,
  init?: HeadersInit,
): Headers {
  const headers = headersWithUpstreamRequestId(upstream, init);
  const trimmedLogical = logicalRequestId?.trim();
  if (!trimmedLogical) {
    return headers;
  }

  // Idempotent: keep previously stamped provider metadata across nested rebuilds.
  const existingProviderMeta =
    upstream.get(ECO_PROVIDER_REQUEST_ID_HEADER)?.trim() ||
    headers.get(ECO_PROVIDER_REQUEST_ID_HEADER)?.trim();
  if (existingProviderMeta && !headers.has(ECO_PROVIDER_REQUEST_ID_HEADER)) {
    headers.set(ECO_PROVIDER_REQUEST_ID_HEADER, existingProviderMeta);
  }

  const rawUpstreamId = readUpstreamRequestId(upstream);
  const providerRequestId =
    existingProviderMeta ||
    (rawUpstreamId && rawUpstreamId !== trimmedLogical ? rawUpstreamId : undefined);
  if (providerRequestId && providerRequestId !== trimmedLogical) {
    headers.set(ECO_PROVIDER_REQUEST_ID_HEADER, providerRequestId);
  }
  headers.set("request-id", trimmedLogical);
  return headers;
}
