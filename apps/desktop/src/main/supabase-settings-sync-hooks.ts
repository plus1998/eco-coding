/**
 * Build SettingsSyncHooks from Desktop provider / ASR / image / workflow / orchestration stores.
 */
import type {
  AsrApiMode,
  AsrProfileSaveInput,
  ProviderConfigInput,
} from "../shared/ipc";
import type { ImageGenerationProfileSaveInput } from "../shared/image-generation";
import type { AsrSettingsStore } from "./asr-settings-store";
import type { AgentOrchestrationStore } from "./agent-orchestration-store";
import type { ImageGenerationStore } from "./image-generation-store";
import type { ProviderStore } from "./provider-store";
import type { WorkflowSettingsStore } from "./workflow-settings-store";
import {
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

function collectWorkflowSettings(
  store: WorkflowSettingsStore,
): EcoSyncedWorkflowSettings {
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
    mainAgentConfigs: orchestration
      .listMainAgentConfigs()
      .filter((row) => isUserOwnedSource(row.source)),
    mainAgentPrompts: orchestration
      .listMainAgentPrompts()
      .filter((row) => isUserOwnedSource(row.source)),
    subagentOrchestrations: orchestration
      .listSubagentOrchestrations()
      .filter((row) => isUserOwnedSource(row.source)),
    agentTemplates: orchestration
      .listAgentTemplates()
      .filter((row) => isUserOwnedSource(row.source) && !row.builtIn),
  };
}

function applyPayload(
  input: {
    providerStore: ProviderStore;
    asrSettingsStore: AsrSettingsStore;
    imageGenerationStore: ImageGenerationStore;
    workflowSettingsStore: WorkflowSettingsStore;
    agentOrchestrationStore: AgentOrchestrationStore;
  },
  payload: EcoSyncedSettingsPayload,
): void {
  if (payload.version !== 1) {
    return;
  }

  for (const provider of payload.providers) {
    const saveInput: ProviderConfigInput = {
      id: provider.id,
      name: provider.name,
      baseUrl: provider.baseUrl,
      requestPath: provider.requestPath,
      version: provider.version,
      apiCompat: provider.apiCompat as ProviderConfigInput["apiCompat"],
      ...(provider.tokenCountMode
        ? { tokenCountMode: provider.tokenCountMode as ProviderConfigInput["tokenCountMode"] }
        : {}),
      defaultModel: provider.defaultModel,
      enabled: provider.enabled,
      // Omit apiKey so existing local key is preserved until secrets pull.
    };
    input.providerStore.saveProvider(saveInput);
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
    try {
      input.asrSettingsStore.activateProfile(payload.asr.activeProfileId);
    } catch {
      // Active profile may not exist yet on this device.
    }
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
    try {
      input.imageGenerationStore.activateProfile(payload.imageGeneration.activeProfileId, {
        skipApiKeyCheck: true,
      });
    } catch {
      // Active profile may not exist yet on this device.
    }
  }
  input.imageGenerationStore.setEnabled(payload.imageGeneration.enabled, {
    skipApiKeyCheck: true,
  });

  // Templates before orchestrations that reference them; configs/prompts before workflow selection.
  for (const template of payload.agentTemplates ?? []) {
    if (!isUserOwnedSource(template.source) || template.builtIn) {
      continue;
    }
    try {
      input.agentOrchestrationStore.saveAgentTemplate({ ...template, source: "user", builtIn: false });
    } catch {
      // Skip malformed remote templates rather than failing the whole pull.
    }
  }
  for (const config of payload.mainAgentConfigs ?? []) {
    if (!isUserOwnedSource(config.source)) {
      continue;
    }
    try {
      input.agentOrchestrationStore.saveMainAgentConfig({ ...config, source: "user" });
    } catch {
      // skip
    }
  }
  for (const prompt of payload.mainAgentPrompts ?? []) {
    if (!isUserOwnedSource(prompt.source)) {
      continue;
    }
    try {
      input.agentOrchestrationStore.saveMainAgentPrompt({ ...prompt, source: "user" });
    } catch {
      // skip
    }
  }
  for (const orchestration of payload.subagentOrchestrations ?? []) {
    if (!isUserOwnedSource(orchestration.source)) {
      continue;
    }
    try {
      input.agentOrchestrationStore.saveSubagentOrchestration({
        ...orchestration,
        source: "user",
      });
    } catch {
      // skip
    }
  }

  if (payload.workflow) {
    const current = input.workflowSettingsStore.get();
    input.workflowSettingsStore.save({
      ...payload.workflow,
      // Preserve local Cursor API key until secrets pull applies it.
      ...(current.acpCursorApiKey ? { acpCursorApiKey: current.acpCursorApiKey } : {}),
    });
  }
}

function collectSecrets(input: {
  providerStore: ProviderStore;
  asrSettingsStore: AsrSettingsStore;
  imageGenerationStore: ImageGenerationStore;
  workflowSettingsStore: WorkflowSettingsStore;
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

  // ImageGenerationStore only decrypts the active profile via getActiveClientConfig.
  // Inactive image profile keys are not pushed until the store exposes a list API.
  try {
    const imageSettings = input.imageGenerationStore.getSettings();
    const active = input.imageGenerationStore.getActiveClientConfig();
    if (active.apiKey.trim() && imageSettings.activeProfileId) {
      secrets.push({ kind: "image", key: imageSettings.activeProfileId, value: active.apiKey });
    }
  } catch {
    // no active image key
  }

  const cursorApiKey = input.workflowSettingsStore.get().acpCursorApiKey?.trim();
  if (cursorApiKey) {
    secrets.push({
      kind: "workflow",
      key: ECO_WORKFLOW_CURSOR_API_KEY_SECRET,
      value: cursorApiKey,
    });
  }

  return secrets;
}

function applySecrets(
  input: {
    providerStore: ProviderStore;
    asrSettingsStore: AsrSettingsStore;
    imageGenerationStore: ImageGenerationStore;
    workflowSettingsStore: WorkflowSettingsStore;
  },
  secrets: EcoPlainSecret[],
): void {
  for (const secret of secrets) {
    if (!secret.value.trim()) {
      continue;
    }
    if (secret.kind === "provider") {
      const existing = input.providerStore.getProviderWithSecret(secret.key);
      if (!existing) {
        continue;
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
        continue;
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
        continue;
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
    }
  }
}

export { emptyEcoSyncedSettingsPayload };
