/**
 * Test helper: product-layer Bridge rewrite before pure gateway handler.
 * Mirrors Desktop eco-sdk-bridge product resolution (not gateway itself).
 */

import { InvalidCodexGatewayModelAliasError, parseCodexGatewayModelAlias } from "@eco/shared";
import {
  GATEWAY_PROVIDER_ID_HEADER,
  GATEWAY_REQUESTED_MODEL_HEADER,
  GATEWAY_UPSTREAM_KIND_HEADER,
  mapApiCompatToUpstreamKind,
} from "../src/provider-router.js";
import { createGatewayFetchHandler, type GatewayLogFn } from "../src/server.js";
import type { GatewayConfig, GatewayProvider, GatewayUsageObserver } from "../src/types.js";

export interface ProductRoute {
  providerId: string;
  upstreamModelId: string;
  upstreamKind?: string;
  clientModel: string;
}

/**
 * Product-layer route resolution (aliases, eco_{id}, models[] match).
 * Gateway never performs this.
 */
export function resolveProductRoute(
  model: string | undefined,
  providers: readonly GatewayProvider[],
): ProductRoute | { error: string } | undefined {
  if (!model?.trim()) {
    return undefined;
  }
  const requested = model.trim();

  try {
    const scoped = parseCodexGatewayModelAlias(requested);
    if (scoped) {
      const match = providers.find((p) => p.id === scoped.providerId);
      if (!match) {
        return { error: `No gateway provider for model: ${requested}` };
      }
      return {
        providerId: match.id,
        upstreamModelId: scoped.upstreamModelId,
        clientModel: requested,
        ...(scoped.apiCompat ? { upstreamKind: mapApiCompatToUpstreamKind(scoped.apiCompat) } : {}),
      };
    }
  } catch (error) {
    if (error instanceof InvalidCodexGatewayModelAliasError) {
      return {
        error: `Invalid gateway route alias for model '${requested}': ${error.message}`,
      };
    }
    throw error;
  }

  const ecoMatch = providers.find((p) => requested === `eco_${p.id}`);
  if (ecoMatch) {
    return {
      providerId: ecoMatch.id,
      upstreamModelId: ecoMatch.upstreamModelId,
      clientModel: requested,
    };
  }

  const exact = providers.find((p) => p.models.includes(requested));
  if (exact) {
    return {
      providerId: exact.id,
      upstreamModelId: requested,
      clientModel: requested,
    };
  }

  return undefined;
}

/**
 * Wrap a pure gateway fetch handler with Bridge-style product resolution.
 */
export function withTestBridge(
  handler: (request: Request) => Response | Promise<Response>,
  getProviders: () => readonly GatewayProvider[],
): (request: Request) => Promise<Response> {
  return async (request: Request) => {
    if (request.headers.get(GATEWAY_PROVIDER_ID_HEADER)?.trim()) {
      return handler(request);
    }
    if (request.method !== "POST") {
      return handler(request);
    }

    const bodyText = await request.text();
    let body: Record<string, unknown> = {};
    if (bodyText.trim()) {
      try {
        body = JSON.parse(bodyText) as Record<string, unknown>;
      } catch {
        return handler(
          new Request(request.url, {
            method: request.method,
            headers: request.headers,
            body: bodyText,
            duplex: "half",
          } as RequestInit),
        );
      }
    }

    const model = typeof body.model === "string" ? body.model : undefined;
    const resolved = resolveProductRoute(model, getProviders());
    if (resolved && "error" in resolved) {
      return Response.json({ error: { message: resolved.error } }, { status: 400 });
    }
    if (!resolved) {
      return handler(
        new Request(request.url, {
          method: request.method,
          headers: request.headers,
          body: bodyText || undefined,
          duplex: bodyText ? "half" : undefined,
        } as RequestInit),
      );
    }

    body.model = resolved.upstreamModelId;
    const headers = new Headers(request.headers);
    headers.set(GATEWAY_PROVIDER_ID_HEADER, resolved.providerId);
    headers.set(GATEWAY_REQUESTED_MODEL_HEADER, resolved.clientModel);
    if (resolved.upstreamKind) {
      headers.set(GATEWAY_UPSTREAM_KIND_HEADER, resolved.upstreamKind);
    }
    headers.delete("content-length");
    return handler(
      new Request(request.url, {
        method: request.method,
        headers,
        body: JSON.stringify(body),
        duplex: "half",
      } as RequestInit),
    );
  };
}

/** Gateway tests: pure handler + product Bridge rewrite using live config.providers. */
export function createTestGatewayFetchHandler(
  config: GatewayConfig,
  fetchImpl: typeof fetch = fetch,
  onLog: GatewayLogFn = () => undefined,
  onUsage?: GatewayUsageObserver,
  onRequestLifecycle?: import("../types.js").GatewayRequestLifecycleObserver,
): (request: Request) => Promise<Response> {
  return withTestBridge(
    createGatewayFetchHandler(config, fetchImpl, onLog, onUsage, onRequestLifecycle),
    () => config.providers,
  );
}
