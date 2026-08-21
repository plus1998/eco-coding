/**
 * Build SettingsSyncHooks from Desktop provider / ASR / image / workflow / orchestration stores.
 */
import type {
  AsrApiMode,
  AsrProfileSaveInput,
  CandidateModelInput,
  ProviderConfigInput,
  RouteProfileInput,
} from "../shared/ipc";
import type { ImageGenerationProfileSaveInput } from "../shared/image-generation";
import type { AsrSettingsStore } from "./asr-settings-store";
import type { AgentOrchestrationStore } from "./agent-orchestration-store";
import type { ImageGenerationStore } from "./image-generation-store";
import type { ProviderStore } from "./provider-store";
import type { ProxyBridgeSettingsStore } from "./proxy-bridge-settings-store";
import type { WorkflowSettingsStore } from "./workflow-settings-store";
import {
  ECO_PROXY_URL_SECRET,
  ECO_WORKFLOW_CURSOR_API_KEY_SECRET,
  emptyEcoSyncedSettingsPayload,
  type EcoPlainSecret,
  type EcoSyncedSettingsPayload,
  type EcoSyncedWorkflowSettings,
  type SettingsSyncHooks,
} from "./supabase-settings-sync";

export function createDesktopSettingsSyncHooks(input: {
  providerStore: ProviderStore;
  asrSettingsStore: AsrSettingsStore;
  imageGenerationStore: ImageGenerationStore;
  workflowSettingsStore: WorkflowSettingsStore;
  agentOrchestrationStore: AgentOrchestrationStore;
  proxyBridgeSettingsStore: ProxyBridgeSettingsStore;
}): SettingsSyncHooks {
  return {
    collectSettingsPayload: () => collectPayload(input),
    applySettingsPayload: (payload) => applyPayload(input, payload),
    collectPlainSecrets: () => collectSecrets(input),
    applyPlainSecrets: (secrets) => applySecrets(input, secrets),
  };
}

function isUserOwnedSource(source: string | undefined): boolean {
  return source === "user" || source === undefined;
}

function collectWorkflowSettings(store: WorkflowSettingsStore): EcoSyncedWorkflowSettings {
  const snapshot = store.get();
  const { acpCursorApiKey: _omit, ...rest } = snapshot;
  return rest;
}

function collectPayload(input: {
  providerStore: ProviderStore;
  asrSettingsStore: AsrSettingsStore;
  imageGenerationStore: ImageGenerationStore;
  workflowSettingsStore: WorkflowSettingsStore;
  agentOrchestrationStore: AgentOrchestrationStore;
  proxyBridgeSettingsStore: ProxyBridgeSettingsStore;
}): EcoSyncedSettingsPayload {
  const providers = input.providerStore.listProviders().map((provider) => ({
    id: provider.id,
    name: provider.name,
    baseUrl: provider.baseUrl,
    requestPath: provider.requestPath,
    version: provider.version,
    apiCompat: provider.apiCompat,
    ...(provider.tokenCountMode ? { tokenCountMode: provider.tokenCountMode } : {}),
    defaultModel: provider.defaultModel,
    enabled: provider.enabled,
  }));

  const asr = input.asrSettingsStore.listProfiles();
  const image = input.imageGenerationStore.getSettings();
  const orchestration = input.agentOrchestrationStore;

  return {
    version: 1,
    providers,
    asr: {
      activeProfileId: asr.activeProfileId,
      profiles: asr.profiles.map((profile) => ({
        id: profile.id,
        name: profile.name,
        endpoint: profile.endpoint,
        apiMode: profile.apiMode,
        model: profile.model,
        systemPrompt: profile.systemPrompt,
      })),
    },
    imageGeneration: {
      enabled: image.enabled,
      activeProfileId: image.activeProfileId,
      profiles: image.profiles.map((profile) => ({
        id: profile.id,
        name: profile.name,
        provider: profile.provider,
        endpoint: profile.endpoint,
        model: profile.model,
      })),
    },
    workflow: collectWorkflowSettings(input.workflowSettingsStore),
    mainAgentConfigs: orchestration.listMainAgentConfigs().filter((row) => isUserOwnedSource(row.source)),
    mainAgentPrompts: orchestration.listMainAgentPrompts().filter((row) => isUserOwnedSource(row.source)),
    subagentOrchestrations: orchestration
      .listSubagentOrchestrations()
      .filter((row) => isUserOwnedSource(row.source)),
    agentTemplates: orchestration
      .listAgentTemplates()
      .filter((row) => isUserOwnedSource(row.source) && !row.builtIn),
    candidateModels: providers.flatMap((provider) =>
      input.providerStore.listCandidateModels(provider.id).map(
        (candidate): CandidateModelInput => ({
          id: candidate.id,
          providerId: candidate.providerId,
          modelId: candidate.modelId,
          ...(candidate.displayName ? { displayName: candidate.displayName } : {}),
          ...(candidate.modelsDevMapping ? { modelsDevMapping: candidate.modelsDevMapping } : {}),
          ...(candidate.manualSpec ? { manualSpec: candidate.manualSpec } : {}),
          sortOrder: candidate.sortOrder,
        }),
      ),
    ),
    routeProfiles: input.providerStore.listRouteProfiles().map(
      (profile): RouteProfileInput => ({
        id: profile.id,
        name: profile.name,
        routes: profile.routes,
      }),
    ),
    proxyBridge: {
      ...(input.proxyBridgeSettingsStore.get().upstreamUserAgent
        ? { upstreamUserAgent: input.proxyBridgeSettingsStore.get().upstreamUserAgent }
        : {}),
    },
  };
}

function applyPayload(
  input: {
    providerStore: ProviderStore;
    asrSettingsStore: AsrSettingsStore;
    imageGenerationStore: ImageGenerationStore;
    workflowSettingsStore: WorkflowSettingsStore;
    agentOrchestrationStore: AgentOrchestrationStore;
    proxyBridgeSettingsStore: ProxyBridgeSettingsStore;
  },
  payload: EcoSyncedSettingsPayload,
): void {
  if (payload.version !== 1) {
    throw new Error(`Unsupported settings payload version: ${String(payload.version)}`);
  }

  for (const provider of payload.providers) {
    const saveInput: ProviderConfigInput = {
      id: provider.id,
      name: provider.name,
      baseUrl: provider.baseUrl,
      requestPath: provider.requestPath,
      version: provider.version,
      apiCompat: provider.apiCompat as NonNullable<ProviderConfigInput["apiCompat"]>,
      ...(provider.tokenCountMode
        ? {
            tokenCountMode: provider.tokenCountMode as NonNullable<ProviderConfigInput["tokenCountMode"]>,
          }
        : {}),
      defaultModel: provider.defaultModel,
      enabled: provider.enabled,
      // Omit apiKey so existing local key is preserved until secrets pull.
    };
    input.providerStore.saveProvider(saveInput);
  }

  for (const candidate of payload.candidateModels ?? []) {
    input.providerStore.saveCandidateModel(candidate);
  }
  for (const profile of payload.routeProfiles ?? []) {
    input.providerStore.saveRouteProfile(profile);
  }

  for (const profile of payload.asr.profiles) {
    const saveInput: AsrProfileSaveInput = {
      id: profile.id,
      name: profile.name,
      endpoint: profile.endpoint,
      apiMode: profile.apiMode as AsrApiMode,
      model: profile.model,
      systemPrompt: profile.systemPrompt,
    };
    input.asrSettingsStore.saveProfile(saveInput);
  }
  if (payload.asr.activeProfileId) {
    input.asrSettingsStore.activateProfile(payload.asr.activeProfileId);
  }

  for (const profile of payload.imageGeneration.profiles) {
    const saveInput: ImageGenerationProfileSaveInput = {
      id: profile.id,
      name: profile.name,
      provider: profile.provider as ImageGenerationProfileSaveInput["provider"],
      endpoint: profile.endpoint,
      model: profile.model,
    };
    input.imageGenerationStore.saveProfile(saveInput);
  }
  if (payload.imageGeneration.activeProfileId) {
    input.imageGenerationStore.activateProfile(payload.imageGeneration.activeProfileId, {
      skipApiKeyCheck: true,
    });
  }
  input.imageGenerationStore.setEnabled(payload.imageGeneration.enabled, {
    skipApiKeyCheck: true,
  });

  // Templates before orchestrations that reference them; configs/prompts before workflow selection.
  for (const template of payload.agentTemplates ?? []) {
    if (!isUserOwnedSource(template.source) || template.builtIn) {
      continue;
    }
    input.agentOrchestrationStore.saveAgentTemplate({
      ...template,
      source: "user",
      builtIn: false,
    });
  }
  for (const config of payload.mainAgentConfigs ?? []) {
    if (!isUserOwnedSource(config.source)) {
      continue;
    }
    input.agentOrchestrationStore.saveMainAgentConfig({ ...config, source: "user" });
  }
  for (const prompt of payload.mainAgentPrompts ?? []) {
    if (!isUserOwnedSource(prompt.source)) {
      continue;
    }
    input.agentOrchestrationStore.saveMainAgentPrompt({ ...prompt, source: "user" });
  }
  for (const orchestration of payload.subagentOrchestrations ?? []) {
    if (!isUserOwnedSource(orchestration.source)) {
      continue;
    }
    input.agentOrchestrationStore.saveSubagentOrchestration({
      ...orchestration,
      source: "user",
    });
  }

  if (payload.workflow) {
    const current = input.workflowSettingsStore.get();
    input.workflowSettingsStore.save({
      ...payload.workflow,
      // Preserve local Cursor API key until secrets pull applies it.
      ...(current.acpCursorApiKey ? { acpCursorApiKey: current.acpCursorApiKey } : {}),
    });
  }
  if (payload.proxyBridge) {
    const current = input.proxyBridgeSettingsStore.get();
    input.proxyBridgeSettingsStore.save({
      ...payload.proxyBridge,
      ...(current.upstreamProxyUrl ? { upstreamProxyUrl: current.upstreamProxyUrl } : {}),
    });
  }
}

function collectSecrets(input: {
  providerStore: ProviderStore;
  asrSettingsStore: AsrSettingsStore;
  imageGenerationStore: ImageGenerationStore;
  workflowSettingsStore: WorkflowSettingsStore;
  proxyBridgeSettingsStore: ProxyBridgeSettingsStore;
}): EcoPlainSecret[] {
  const secrets: EcoPlainSecret[] = [];

  for (const provider of input.providerStore.listProvidersWithSecrets()) {
    if (provider.apiKey.trim()) {
      secrets.push({ kind: "provider", key: provider.id, value: provider.apiKey });
    }
  }

  const asr = input.asrSettingsStore.listProfiles();
  for (const profile of asr.profiles) {
    const config = input.asrSettingsStore.getClientConfig(profile.id);
    if (config?.apiKey.trim()) {
      secrets.push({ kind: "asr", key: profile.id, value: config.apiKey });
    }
  }

  for (const imageSecret of input.imageGenerationStore.listProfileSecrets()) {
    if (imageSecret.apiKey.trim()) {
      secrets.push({ kind: "image", key: imageSecret.profileId, value: imageSecret.apiKey });
    }
  }

  const cursorApiKey = input.workflowSettingsStore.get().acpCursorApiKey?.trim();
  if (cursorApiKey) {
    secrets.push({
      kind: "workflow",
      key: ECO_WORKFLOW_CURSOR_API_KEY_SECRET,
      value: cursorApiKey,
    });
  }

  const proxyUrl = input.proxyBridgeSettingsStore.get().upstreamProxyUrl?.trim();
  if (proxyUrl) {
    secrets.push({ kind: "proxy", key: ECO_PROXY_URL_SECRET, value: proxyUrl });
  }

  return secrets;
}

function applySecrets(
  input: {
    providerStore: ProviderStore;
    asrSettingsStore: AsrSettingsStore;
    imageGenerationStore: ImageGenerationStore;
    workflowSettingsStore: WorkflowSettingsStore;
    proxyBridgeSettingsStore: ProxyBridgeSettingsStore;
  },
  secrets: EcoPlainSecret[],
): void {
  const secretIds = new Set(secrets.map((secret) => `${secret.kind}:${secret.key}`));
  for (const provider of input.providerStore.listProvidersWithSecrets()) {
    if (provider.apiKey && !secretIds.has(`provider:${provider.id}`)) {
      input.providerStore.clearProviderApiKey(provider.id);
    }
  }
  for (const profile of input.asrSettingsStore.listProfiles().profiles) {
    if (profile.hasApiKey && !secretIds.has(`asr:${profile.id}`)) {
      input.asrSettingsStore.clearProfileApiKey(profile.id);
    }
  }
  for (const profile of input.imageGenerationStore.listProfileSecrets()) {
    if (!secretIds.has(`image:${profile.profileId}`)) {
      input.imageGenerationStore.clearProfileApiKey(profile.profileId);
    }
  }
  if (!secretIds.has(`workflow:${ECO_WORKFLOW_CURSOR_API_KEY_SECRET}`)) {
    const { acpCursorApiKey: _removed, ...workflow } = input.workflowSettingsStore.get();
    input.workflowSettingsStore.save(workflow);
  }
  if (!secretIds.has(`proxy:${ECO_PROXY_URL_SECRET}`)) {
    const { upstreamProxyUrl: _removed, ...proxy } = input.proxyBridgeSettingsStore.get();
    input.proxyBridgeSettingsStore.save(proxy);
  }

  for (const secret of secrets) {
    if (!secret.value.trim()) {
      continue;
    }
    if (secret.kind === "provider") {
      const existing = input.providerStore.getProviderWithSecret(secret.key);
      if (!existing) {
        throw new Error(`Cloud provider secret references missing provider: ${secret.key}`);
      }
      input.providerStore.saveProvider({
        id: existing.id,
        name: existing.name,
        baseUrl: existing.baseUrl,
        requestPath: existing.requestPath,
        version: existing.version,
        apiCompat: existing.apiCompat,
        ...(existing.tokenCountMode ? { tokenCountMode: existing.tokenCountMode } : {}),
        defaultModel: existing.defaultModel,
        enabled: existing.enabled,
        apiKey: secret.value,
      });
      continue;
    }
    if (secret.kind === "asr") {
      const profiles = input.asrSettingsStore.listProfiles().profiles;
      const profile = profiles.find((row) => row.id === secret.key);
      if (!profile) {
        throw new Error(`Cloud ASR secret references missing profile: ${secret.key}`);
      }
      input.asrSettingsStore.saveProfile({
        id: profile.id,
        name: profile.name,
        endpoint: profile.endpoint,
        apiMode: profile.apiMode,
        model: profile.model,
        systemPrompt: profile.systemPrompt,
        apiKey: secret.value,
      });
      continue;
    }
    if (secret.kind === "image") {
      const settings = input.imageGenerationStore.getSettings();
      const profile = settings.profiles.find((row) => row.id === secret.key);
      if (!profile) {
        throw new Error(`Cloud image secret references missing profile: ${secret.key}`);
      }
      input.imageGenerationStore.saveProfile({
        id: profile.id,
        name: profile.name,
        provider: profile.provider,
        endpoint: profile.endpoint,
        model: profile.model,
        apiKey: secret.value,
      });
      continue;
    }
    if (secret.kind === "workflow" && secret.key === ECO_WORKFLOW_CURSOR_API_KEY_SECRET) {
      const current = input.workflowSettingsStore.get();
      input.workflowSettingsStore.save({
        ...current,
        acpCursorApiKey: secret.value,
      });
      continue;
    }
    if (secret.kind === "proxy" && secret.key === ECO_PROXY_URL_SECRET) {
      input.proxyBridgeSettingsStore.save({
        ...input.proxyBridgeSettingsStore.get(),
        upstreamProxyUrl: secret.value,
      });
    }
  }
}

export { emptyEcoSyncedSettingsPayload };
