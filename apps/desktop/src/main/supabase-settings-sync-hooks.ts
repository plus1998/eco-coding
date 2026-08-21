/**
 * Build SettingsSyncHooks from Desktop provider / ASR / image stores.
 */
import type {
  AsrApiMode,
  AsrProfileSaveInput,
  ProviderConfigInput,
} from "../shared/ipc";
import type { ImageGenerationProfileSaveInput } from "../shared/image-generation";
import type { AsrSettingsStore } from "./asr-settings-store";
import type { ImageGenerationStore } from "./image-generation-store";
import type { ProviderStore } from "./provider-store";
import {
  emptyEcoSyncedSettingsPayload,
  type EcoPlainSecret,
  type EcoSyncedSettingsPayload,
  type SettingsSyncHooks,
} from "./supabase-settings-sync";

export function createDesktopSettingsSyncHooks(input: {
  providerStore: ProviderStore;
  asrSettingsStore: AsrSettingsStore;
  imageGenerationStore: ImageGenerationStore;
}): SettingsSyncHooks {
  return {
    collectSettingsPayload: () => collectPayload(input),
    applySettingsPayload: (payload) => applyPayload(input, payload),
    collectPlainSecrets: () => collectSecrets(input),
    applyPlainSecrets: (secrets) => applySecrets(input, secrets),
  };
}

function collectPayload(input: {
  providerStore: ProviderStore;
  asrSettingsStore: AsrSettingsStore;
  imageGenerationStore: ImageGenerationStore;
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
  };
}

function applyPayload(
  input: {
    providerStore: ProviderStore;
    asrSettingsStore: AsrSettingsStore;
    imageGenerationStore: ImageGenerationStore;
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
      input.imageGenerationStore.activateProfile(payload.imageGeneration.activeProfileId);
    } catch {
      // ignore
    }
  }
  input.imageGenerationStore.setEnabled(payload.imageGeneration.enabled);
}

function collectSecrets(input: {
  providerStore: ProviderStore;
  asrSettingsStore: AsrSettingsStore;
  imageGenerationStore: ImageGenerationStore;
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

  return secrets;
}

function applySecrets(
  input: {
    providerStore: ProviderStore;
    asrSettingsStore: AsrSettingsStore;
    imageGenerationStore: ImageGenerationStore;
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
    }
  }
}

export { emptyEcoSyncedSettingsPayload };
