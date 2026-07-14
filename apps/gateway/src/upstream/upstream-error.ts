import type { ResolvedProviderRoute } from "../types.js";

/** Extract a short user-facing message from an upstream error body. */
export function extractUpstreamErrorMessage(bodyText: string): string {
  const trimmed = bodyText.trim();
  if (!trimmed) {
    return "empty error body";
  }
  try {
    const parsed = JSON.parse(trimmed) as {
      error?: { message?: string } | string;
      message?: string;
    };
    if (typeof parsed.error === "string" && parsed.error.trim()) {
      return parsed.error.trim();
    }
    if (
      parsed.error &&
      typeof parsed.error === "object" &&
      typeof parsed.error.message === "string" &&
      parsed.error.message.trim()
    ) {
      return parsed.error.message.trim();
    }
    if (typeof parsed.message === "string" && parsed.message.trim()) {
      return parsed.message.trim();
    }
  } catch {
    // not JSON
  }
  return trimmed.length > 400 ? `${trimmed.slice(0, 397)}…` : trimmed;
}

/** Attribute upstream failures to provider/model/url so Eco UI does not look like an internal fault. */
export function formatUpstreamHttpError(input: {
  route: ResolvedProviderRoute;
  upstreamUrl: string;
  status: number;
  bodyText: string;
}): string {
  const detail = extractUpstreamErrorMessage(input.bodyText);
  return [
    `Upstream provider ${input.route.provider.id}`,
    `model=${input.route.upstreamModelId}`,
    `url=${input.upstreamUrl}`,
    `status=${input.status}`,
    detail,
  ].join(" · ");
}

export function upstreamErrorResponse(input: {
  route: ResolvedProviderRoute;
  upstreamUrl: string;
  status: number;
  bodyText: string;
}): Response {
  const message = formatUpstreamHttpError(input);
  return Response.json(
    {
      error: {
        message,
        type: "upstream_error",
        providerId: input.route.provider.id,
        model: input.route.upstreamModelId,
        url: input.upstreamUrl,
        status: input.status,
      },
    },
    { status: input.status >= 400 && input.status < 600 ? input.status : 502 },
  );
}
