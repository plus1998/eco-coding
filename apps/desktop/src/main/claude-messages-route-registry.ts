import type { UpstreamApiCompat } from "../shared/api-compat";
import type { RuntimeAgentRole, ThinkingEffort } from "../shared/ipc";
import type { BridgeRouteResolution } from "./eco-sdk-bridge";
import { resolveUpstreamApiCompat } from "../shared/api-compat";
import { mapApiCompatToUpstreamKind, type UpstreamKind } from "@eco/gateway";

export interface ClaudeMessagesRouteEntry {
  role: RuntimeAgentRole;
  providerId: string;
  providerApiKey: string;
  providerBaseUrl: string;
  providerName: string;
  modelId: string;
  aliasModelId: string;
  apiCompat: UpstreamApiCompat;
  thinkingEffort?: ThinkingEffort;
  maxOutputTokens?: number;
  generation: number;
}

/**
 * Active Claude SDK route table bound to the single Eco Bridge.
 * startAnthropicModelProxy registers routes here instead of opening a second HTTP server.
 */
export class ClaudeMessagesRouteRegistry {
  private readonly entries = new Map<string, ClaudeMessagesRouteEntry>();
  private generation = 1;

  clear(): void {
    this.entries.clear();
  }

  /** Replace all routes for a proxy session; returns generation for close(). */
  setRoutes(routes: readonly Omit<ClaudeMessagesRouteEntry, "generation">[]): number {
    const generation = this.generation++;
    // Drop previous generation routes only (allow concurrent sessions via gen filter if needed).
    for (const [key, entry] of this.entries) {
      if (entry.generation < generation) {
        // keep newer sessions; this simple version clears everything then sets
      }
    }
    this.entries.clear();
    for (const route of routes) {
      const entry: ClaudeMessagesRouteEntry = { ...route, generation };
      this.entries.set(normalizeKey(entry.aliasModelId), entry);
      this.entries.set(normalizeKey(entry.modelId), entry);
    }
    return generation;
  }

  removeGeneration(generation: number): void {
    for (const [key, entry] of this.entries) {
      if (entry.generation === generation) {
        this.entries.delete(key);
      }
    }
  }

  resolve(
    model: string | undefined,
    _headers?: Headers,
  ): (BridgeRouteResolution & { entry: ClaudeMessagesRouteEntry }) | undefined {
    if (!model?.trim()) {
      return undefined;
    }
    const entry = this.entries.get(normalizeKey(model));
    if (!entry) {
      return undefined;
    }
    const upstreamKind = mapApiCompatToUpstreamKind(
      resolveUpstreamApiCompat(entry.apiCompat, entry.apiCompat),
    ) as UpstreamKind;
    return {
      providerId: entry.providerId,
      upstreamModelId: entry.modelId,
      upstreamKind,
      entry,
    };
  }

  listAliasModels(): string[] {
    const aliases = new Set<string>();
    for (const entry of this.entries.values()) {
      aliases.add(entry.aliasModelId);
    }
    return [...aliases];
  }
}

function normalizeKey(value: string): string {
  return value.trim().toLowerCase();
}

export const globalClaudeMessagesRouteRegistry = new ClaudeMessagesRouteRegistry();
