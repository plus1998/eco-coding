import {
  type CodexGatewayApiCompat,
  InvalidCodexGatewayModelAliasError,
  parseCodexGatewayModelAlias,
} from "@eco/shared";
import type { GatewayProvider, ResolvedProviderRoute, UpstreamKind } from "./types.js";

export class ProviderNotFoundError extends Error {
  readonly status = 404;

  constructor(model: string) {
    super(`No gateway provider for model: ${model}`);
    this.name = "ProviderNotFoundError";
  }
}

export class InvalidProviderRouteAliasError extends Error {
  readonly status = 400;

  constructor(model: string, reason: string) {
    super(`Invalid gateway route alias for model '${model}': ${reason}`);
    this.name = "InvalidProviderRouteAliasError";
  }
}

export class UnsupportedUpstreamKindError extends Error {
  readonly status = 501;

  constructor(kind: UpstreamKind) {
    super(`Upstream kind not implemented in Phase 0: ${kind}`);
    this.name = "UnsupportedUpstreamKindError";
  }
}

function ecoProviderAlias(providerId: string): string {
  return `eco_${providerId}`;
}

export function resolveProviderRoute(
  model: string | undefined,
  providers: readonly GatewayProvider[],
): ResolvedProviderRoute {
  const requestedModel = model?.trim();
  if (!requestedModel) {
    throw new ProviderNotFoundError("(missing model)");
  }

  let scoped: ReturnType<typeof parseCodexGatewayModelAlias>;
  try {
    scoped = parseCodexGatewayModelAlias(requestedModel);
  } catch (error) {
    if (error instanceof InvalidCodexGatewayModelAliasError) {
      throw new InvalidProviderRouteAliasError(requestedModel, error.message);
    }
    throw error;
  }
  if (scoped) {
    const scopedMatch = providers.find((provider) => provider.id === scoped.providerId);
    if (!scopedMatch) {
      throw new ProviderNotFoundError(requestedModel);
    }
    return {
      provider: scopedMatch,
      upstreamKind: scoped.apiCompat
        ? mapApiCompatToUpstreamKind(scoped.apiCompat)
        : scopedMatch.upstreamKind,
      requestedModel,
      upstreamModelId: scoped.upstreamModelId,
    };
  }

  const ecoMatch = providers.find((provider) => requestedModel === ecoProviderAlias(provider.id));
  if (ecoMatch) {
    return {
      provider: ecoMatch,
      upstreamKind: ecoMatch.upstreamKind,
      requestedModel,
      // eco_{id} is an Eco-only alias; send the provider's configured upstream model.
      upstreamModelId: ecoMatch.upstreamModelId,
    };
  }

  const exact = providers.find((provider) => provider.models.includes(requestedModel));
  if (exact) {
    return {
      provider: exact,
      upstreamKind: exact.upstreamKind,
      requestedModel,
      // Explicit model ids from Codex/ThreadRuntimeConfig are forwarded as-is.
      upstreamModelId: requestedModel,
    };
  }

  throw new ProviderNotFoundError(requestedModel);
}

function mapApiCompatToUpstreamKind(apiCompat: CodexGatewayApiCompat): UpstreamKind {
  switch (apiCompat) {
    case "anthropic":
      return "anthropic-messages";
    case "openai_responses":
      return "responses";
    case "openai_chat_completions":
      return "openai-chat";
    default: {
      const _exhaustive: never = apiCompat;
      return _exhaustive;
    }
  }
}

export function buildUpstreamUrl(provider: GatewayProvider, upstreamKind: UpstreamKind): string {
  const root = provider.baseUrl.replace(/\/+$/, "");
  switch (upstreamKind) {
    case "anthropic-messages":
      return `${root}/v1/messages`;
    case "responses":
    case "gateway-delegated":
      return `${root}/v1/responses`;
    case "openai-chat":
      return `${root}/v1/chat/completions`;
    default: {
      const _exhaustive: never = upstreamKind;
      return _exhaustive;
    }
  }
}
