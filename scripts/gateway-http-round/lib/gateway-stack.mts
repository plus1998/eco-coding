import { type EcoSdkBridgeServer, startEcoSdkBridge } from "../../../apps/desktop/src/main/eco-sdk-bridge.ts";
import { normalizeProvider } from "../../../apps/gateway/src/provider-config.ts";
import { startEcoGateway } from "../../../apps/gateway/src/server.ts";
import type { GatewayProvider } from "../../../apps/gateway/src/types.ts";
import {
  buildCodexGatewayModelAlias,
  resolveEcoGatewayPort,
} from "../../../packages/runtime/src/codex-config-sync.ts";
import { upstreamKindToApiCompat } from "./client-matrix.mjs";
import { resolveProfile } from "./profiles.mjs";
import { createUpstreamLoggingFetch } from "./upstream-logger.mjs";

export interface GatewayRecordingCell {
  client: string;
  profileId: string;
  scenarioId: string;
}

export interface GatewayRecordingStack {
  port: number;
  bridgeBaseUrl: string;
  gatewayBaseUrl: string;
  profileIds: string[];
  secrets: string[];
  setActiveCell: (cell: GatewayRecordingCell) => void;
  stop: () => void;
}

function toGatewayProvider(profileId: string): GatewayProvider {
  const profile = resolveProfile(profileId);
  const modelAlias = buildCodexGatewayModelAlias(profile.id, profile.model);
  return normalizeProvider({
    id: profile.id,
    name: profile.label,
    upstreamKind: profile.upstreamKind,
    baseUrl: profile.baseUrl,
    apiKey: profile.apiKey,
    upstreamModelId: profile.model,
    models: [profile.model, modelAlias, `eco_${profile.id}`],
  });
}

export async function createGatewayRecordingStack(input: {
  profileIds: string[];
  upstreamLogPath: string;
  artifactDir: string;
  port?: number;
}): Promise<GatewayRecordingStack> {
  const port = input.port ?? resolveEcoGatewayPort();
  const bridgeBaseUrl = `http://127.0.0.1:${port}`;
  const gatewayBaseUrl = `${bridgeBaseUrl}/v1`;

  const providers = input.profileIds.map((id) => toGatewayProvider(id));
  const secrets = input.profileIds.map((id) => resolveProfile(id).apiKey);

  let activeCell: GatewayRecordingCell = {
    client: "unknown",
    profileId: input.profileIds[0] ?? "unknown",
    scenarioId: "full_round",
  };
  const seqRef = { value: 0 };

  const loggingFetch = createUpstreamLoggingFetch({
    logPath: input.upstreamLogPath,
    artifactDir: input.artifactDir,
    getCell: () => activeCell,
    getSecrets: () => secrets,
    seqRef,
  });

  const gateway = await startEcoGateway(
    {
      host: "127.0.0.1",
      port,
      providers,
    },
    {
      embedded: true,
      fetchImpl: loggingFetch,
      onLog: (message) => process.stderr.write(`[eco-gateway] ${message}\n`),
    },
  );

  let bridge: EcoSdkBridgeServer | undefined;
  try {
    bridge = await startEcoSdkBridge("127.0.0.1", port, {
      gateway,
      getProviders: () =>
        gateway.getProviders().map((p) => ({
          id: p.id,
          upstreamModelId: p.upstreamModelId,
          models: p.models,
        })),
      onLog: (message) => process.stderr.write(`[eco-bridge] ${message}\n`),
    });
  } catch (error) {
    gateway.stop();
    throw error;
  }

  return {
    port,
    bridgeBaseUrl,
    gatewayBaseUrl,
    profileIds: input.profileIds,
    secrets,
    setActiveCell: (cell) => {
      activeCell = cell;
    },
    stop: () => {
      bridge?.stop();
      gateway.stop();
    },
  };
}

export function resolveProfileApiCompat(profileId: string) {
  const profile = resolveProfile(profileId);
  return upstreamKindToApiCompat(profile.upstreamKind);
}

export function resolveProfileModelAlias(profileId: string) {
  const profile = resolveProfile(profileId);
  return buildCodexGatewayModelAlias(profile.id, profile.model);
}
