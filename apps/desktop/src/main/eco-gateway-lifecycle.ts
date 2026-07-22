import {
  normalizeProvider,
  startEcoGateway,
  type EcoGatewayServer,
  type GatewayProvider,
  type GatewayUsageObserver,
} from "@eco/gateway";
import { resolveEcoGatewayPort } from "@eco/runtime";
import type { UpstreamApiCompat } from "../shared/api-compat";

export type GatewayUpstreamKind =
  | "anthropic-messages"
  | "responses"
  | "openai-chat"
  | "gateway-delegated";

export interface EcoProviderForGateway {
  id: string;
  name: string;
  enabled: boolean;
  baseUrl: string;
  apiKey: string;
  apiCompat: UpstreamApiCompat;
  defaultModel: string;
  /** Extra model ids that Codex may send (candidates / route models). */
  modelIds?: readonly string[];
  models?: readonly {
    modelId: string;
    maxOutputTokens?: number;
  }[];
}

export interface GatewayProviderPayload {
  id: string;
  name: string;
  upstreamKind: GatewayUpstreamKind;
  baseUrl: string;
  apiKey: string;
  upstreamModelId: string;
  models: string[];
  modelMaxOutputTokens?: Record<string, number>;
}

export interface EcoGatewayLifecycleOptions {
  ecoDataDir: string;
  listProviders: () => readonly EcoProviderForGateway[];
  gatewayPort?: number;
  onStderr?: (chunk: string) => void;
  onUsage?: GatewayUsageObserver;
}

/**
 * In-process eco-gateway hosted by Electron main (Node http).
 * No Bun subprocess — works in packaged releases.
 */
export class EcoGatewayLifecycle {
  private server: EcoGatewayServer | undefined;
  private lastIncompleteProviderIds: string[] = [];

  constructor(private readonly options: EcoGatewayLifecycleOptions) {}

  get port(): number {
    return this.options.gatewayPort ?? resolveEcoGatewayPort();
  }

  get baseUrl(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  get incompleteProviderIds(): readonly string[] {
    return this.lastIncompleteProviderIds;
  }

  async ensureRunning(): Promise<GatewayProviderPayload[]> {
    const built = buildGatewayProvidersFromEcoProviders(this.options.listProviders());
    this.lastIncompleteProviderIds = built.incompleteProviderIds;
    if (built.incompleteProviderIds.length > 0) {
      this.options.onStderr?.(
        `[eco-gateway] skipping incomplete providers (missing baseUrl/defaultModel): ${built.incompleteProviderIds.join(", ")}\n`,
      );
    }
    const gatewayProviders = built.providers.map((provider) =>
      normalizeProvider(provider as GatewayProvider),
    );

    const log = (message: string) => {
      this.options.onStderr?.(`[eco-gateway] ${message}\n`);
    };

    if (!this.server) {
      try {
        this.server = await startEcoGateway(
          {
            host: "127.0.0.1",
            port: this.port,
            providers: gatewayProviders,
          },
          {
            onLog: (message) => log(message),
            ...(this.options.onUsage && { onUsage: this.options.onUsage }),
          },
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/EADDRINUSE/i.test(message)) {
          throw new Error(
            `eco-gateway port ${this.port} is already in use by another process. Stop it so Electron main can host the in-process gateway.`,
          );
        }
        throw error;
      }
      log(`listening in-process on ${this.baseUrl} (node http)`);
    } else {
      this.server.setProviders(gatewayProviders);
      log(`providers updated (${gatewayProviders.length})`);
    }

    for (const provider of built.providers) {
      log(
        `provider ${provider.id} kind=${provider.upstreamKind} baseUrl=${provider.baseUrl} models=${provider.models.join(",")}`,
      );
    }

    return built.providers;
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = undefined;
    server?.stop();
  }
}

export function mapApiCompatToUpstreamKind(apiCompat: UpstreamApiCompat): GatewayUpstreamKind {
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

/** Strip trailing /v1 so gateway can append /v1/responses|chat/completions|messages. */
export function normalizeGatewayBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, "").replace(/\/v1$/i, "");
}

export interface BuildGatewayProvidersResult {
  providers: GatewayProviderPayload[];
  /** Enabled providers skipped because baseUrl / defaultModel is incomplete. */
  incompleteProviderIds: string[];
}

/**
 * Build gateway provider table from Eco ProviderStore.
 * Incomplete enabled providers are skipped (not fatal) so one broken row cannot block all runs.
 * Callers must verify the thread's providerId is present via assertGatewayProvidersCover().
 */
export function buildGatewayProvidersFromEcoProviders(
  providers: readonly EcoProviderForGateway[],
): BuildGatewayProvidersResult {
  const enabled = providers.filter((provider) => provider.enabled);
  if (enabled.length === 0) {
    throw new Error("No enabled Eco providers to sync into eco-gateway.");
  }

  const incompleteProviderIds: string[] = [];
  const out: GatewayProviderPayload[] = [];

  for (const provider of enabled) {
    const id = provider.id.trim();
    const baseUrl = normalizeGatewayBaseUrl(provider.baseUrl);
    const defaultModel =
      provider.defaultModel.trim() ||
      (provider.modelIds ?? []).map((modelId) => modelId.trim()).find(Boolean) ||
      "";
    if (!id || !baseUrl || !defaultModel) {
      incompleteProviderIds.push(id || provider.id || "(unknown)");
      continue;
    }
    const ecoAlias = `eco_${id}`;
    const upstreamModels = uniqueNonEmpty([
      defaultModel,
      ...(provider.models ?? []).map((model) => model.modelId),
      ...(provider.modelIds ?? []),
    ]);
    const models = uniqueNonEmpty([
      ecoAlias,
      ...upstreamModels.map((modelId) => `${ecoAlias}__${modelId}`),
      ...upstreamModels,
    ]);
    const modelMaxOutputTokens = collectModelMaxOutputTokens(provider.models);
    out.push({
      id,
      name: provider.name.trim() || id,
      upstreamKind: mapApiCompatToUpstreamKind(provider.apiCompat),
      baseUrl,
      apiKey: provider.apiKey.trim() || "local-unused",
      upstreamModelId: defaultModel,
      models,
      ...(modelMaxOutputTokens ? { modelMaxOutputTokens } : {}),
    });
  }

  if (out.length === 0) {
    throw new Error(
      `No enabled providers have both baseUrl and defaultModel. Incomplete: ${incompleteProviderIds.join(", ")}. Open Settings → Providers and set Base URL, then add candidate models.`,
    );
  }

  return { providers: out, incompleteProviderIds };
}

function collectModelMaxOutputTokens(
  models: EcoProviderForGateway["models"],
): Record<string, number> | undefined {
  const limits: Record<string, number> = {};
  for (const model of models ?? []) {
    const modelId = model.modelId.trim();
    const tokens = model.maxOutputTokens;
    if (!modelId || tokens === undefined || !Number.isFinite(tokens) || tokens <= 0) {
      continue;
    }
    limits[modelId] = Math.floor(tokens);
  }
  return Object.keys(limits).length > 0 ? limits : undefined;
}

export function assertGatewayProvidersCover(
  gatewayProviders: readonly GatewayProviderPayload[],
  requiredProviderIds: readonly string[],
  incompleteProviderIds: readonly string[] = [],
): void {
  const available = new Set(gatewayProviders.map((provider) => provider.id));
  const incomplete = new Set(incompleteProviderIds);
  for (const providerId of requiredProviderIds) {
    const id = providerId.trim();
    if (!id || available.has(id)) {
      continue;
    }
    if (incomplete.has(id)) {
      throw new Error(
        `Provider ${id} is missing baseUrl or defaultModel. Open Settings → Providers, edit this provider, set Base URL (http://… or https://…), and add candidate models.`,
      );
    }
    throw new Error(
      `Provider ${id} is not enabled or not synced to eco-gateway. Enable it in Settings → Providers.`,
    );
  }
}

let globalGateway: EcoGatewayLifecycle | undefined;

export function configureEcoGatewayLifecycle(options: EcoGatewayLifecycleOptions): EcoGatewayLifecycle {
  globalGateway = new EcoGatewayLifecycle(options);
  return globalGateway;
}

export async function ensureGlobalEcoGateway(options?: {
  requiredProviderIds?: readonly string[];
}): Promise<GatewayProviderPayload[]> {
  if (!globalGateway) {
    throw new Error("eco-gateway lifecycle is not configured. Call configureEcoGatewayLifecycle() at startup.");
  }
  const providers = await globalGateway.ensureRunning();
  if (options?.requiredProviderIds?.length) {
    assertGatewayProvidersCover(
      providers,
      options.requiredProviderIds,
      globalGateway.incompleteProviderIds,
    );
  }
  return providers;
}

export async function stopGlobalEcoGateway(): Promise<void> {
  await globalGateway?.stop();
  globalGateway = undefined;
}

function uniqueNonEmpty(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}
