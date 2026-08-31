import { Check, Image, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  defaultImageGenerationEndpoint,
  defaultImageGenerationModel,
  type ImageGenerationProfileSaveInput,
  type ImageGenerationProfileSnapshot,
  type ImageGenerationProvider,
  type ImageGenerationSettingsSnapshot,
} from "../shared/image-generation";
import type { CenterServerSyncDomainResult } from "../shared/center-server";
import { SettingsSyncControl } from "./SettingsSyncControl";

interface Props {
  settings: ImageGenerationSettingsSnapshot;
  onChange: (settings: ImageGenerationSettingsSnapshot) => void;
  onError: (message: string) => void;
  centerServerSyncVisible?: boolean;
  onSyncDomain?: (
    domain: "imageGeneration",
    mode: "pull" | "push",
  ) => Promise<CenterServerSyncDomainResult>;
}

function formFromProfile(profile: ImageGenerationProfileSnapshot): ImageGenerationProfileSaveInput {
  return {
    id: profile.id,
    name: profile.name,
    provider: profile.provider,
    endpoint: profile.endpoint,
    model: profile.model,
  };
}

export function ImageGenerationSettingsPanel({
  settings,
  onChange,
  onError,
  centerServerSyncVisible = false,
  onSyncDomain,
}: Props) {
  const { t } = useTranslation();
  const [selectedId, setSelectedId] = useState(settings.activeProfileId);
  const selected = useMemo(
    () => settings.profiles.find((profile) => profile.id === selectedId),
    [selectedId, settings.profiles],
  );
  const [form, setForm] = useState<ImageGenerationProfileSaveInput>(() =>
    selected ? formFromProfile(selected) : newProfileForm("openai"),
  );
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (selected) setForm(formFromProfile(selected));
  }, [selected]);

  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    try {
      await action();
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  function choose(profile: ImageGenerationProfileSnapshot) {
    setSelectedId(profile.id);
    setForm(formFromProfile(profile));
  }

  return (
    <div className="image-generation-settings">
      <header className="settings-page-header browser-settings-header settings-page-header-with-action">
        <div>
          <h1>{t("settings.imageGeneration.title")}</h1>
          <p className="settings-page-desc">{t("settings.imageGeneration.pageDesc")}</p>
        </div>
        {onSyncDomain ? (
          <SettingsSyncControl
            domain="imageGeneration"
            visible={centerServerSyncVisible}
            disabled={busy}
            onSync={onSyncDomain}
          />
        ) : null}
      </header>
      <section className="browser-settings-card browser-settings-master">
        <div className="browser-settings-master-glyph" aria-hidden>
          <Image size={20} strokeWidth={1.75} />
        </div>
        <div className="browser-settings-master-copy">
          <strong>{t("settings.imageGeneration.masterTitle")}</strong>
          <small>{t("settings.imageGeneration.masterHint")}</small>
        </div>
        <label className="composer-switch browser-settings-switch">
          <input
            type="checkbox"
            checked={settings.enabled}
            disabled={busy}
            aria-label={t("settings.imageGeneration.masterTitle")}
            onChange={(event) =>
              void run(async () => {
                if (!window.eco) throw new Error(t("settings.imageGeneration.desktopOnly"));
                onChange(await window.eco.saveImageGenerationEnabled(event.target.checked));
              })
            }
          />
          <span className="composer-switch-track" aria-hidden />
        </label>
      </section>

      {!settings.apiKeyEncryptionAvailable ? (
        <p className="browser-settings-error">{t("settings.imageGeneration.encryptionUnavailable")}</p>
      ) : null}

      <div className="image-generation-profile-layout">
        <div className="image-generation-profile-list">
          <div className="image-generation-profile-list-header">
            <strong>{t("settings.imageGeneration.profiles")}</strong>
            <button
              type="button"
              className="settings-icon-button image-generation-add-button"
              title={t("settings.imageGeneration.addProfile")}
              aria-label={t("settings.imageGeneration.addProfile")}
              onClick={() => {
                setSelectedId("");
                setForm(newProfileForm("openai"));
              }}
            >
              <Plus size={15} aria-hidden />
            </button>
          </div>
          {settings.profiles.map((profile) => (
            <button
              key={profile.id}
              type="button"
              className={`image-generation-profile-row${selectedId === profile.id ? " selected" : ""}`}
              onClick={() => choose(profile)}
            >
              <span>
                <strong>{profile.name}</strong>
                <small>{profile.provider} · {profile.model}</small>
              </span>
              {settings.activeProfileId === profile.id ? <Check size={14} aria-hidden /> : null}
            </button>
          ))}
        </div>

        <form
          className="settings-form image-generation-profile-form"
          onSubmit={(event) => {
            event.preventDefault();
            void run(async () => {
              if (!window.eco) throw new Error(t("settings.imageGeneration.desktopOnly"));
              const saved = await window.eco.saveImageGenerationProfile(form);
              const next = await window.eco.getImageGenerationSettings();
              onChange(next);
              setSelectedId(saved.id);
            });
          }}
        >
          <label className="settings-form-field">
            <span className="settings-form-label">{t("settings.imageGeneration.profileName")}</span>
            <input
              className="settings-form-input"
              value={form.name}
              disabled={busy}
              required
              onChange={(event) => setForm({ ...form, name: event.target.value })}
            />
          </label>
          <label className="settings-form-field">
            <span className="settings-form-label">{t("settings.imageGeneration.provider")}</span>
            <select
              className="settings-form-input"
              value={form.provider}
              disabled={busy}
              onChange={(event) => {
                const provider = event.target.value as ImageGenerationProvider;
                setForm({
                  ...form,
                  provider,
                  endpoint: defaultImageGenerationEndpoint(provider),
                  model: defaultImageGenerationModel(provider),
                });
              }}
            >
              <option value="openai">OpenAI</option>
              <option value="gemini">Gemini</option>
              <option value="openai_compatible">OpenAI-compatible</option>
            </select>
          </label>
          <label className="settings-form-field">
            <span className="settings-form-label">Base URL</span>
            <input
              className="settings-form-input"
              type="url"
              value={form.endpoint}
              disabled={busy}
              required
              onChange={(event) => setForm({ ...form, endpoint: event.target.value })}
            />
          </label>
          <label className="settings-form-field">
            <span className="settings-form-label">{t("settings.imageGeneration.model")}</span>
            <input
              className="settings-form-input"
              value={form.model}
              disabled={busy}
              required
              onChange={(event) => setForm({ ...form, model: event.target.value })}
            />
          </label>
          <label className="settings-form-field">
            <span className="settings-form-label">API Key</span>
            <input
              className="settings-form-input"
              type="password"
              value={form.apiKey ?? ""}
              disabled={busy || !settings.apiKeyEncryptionAvailable}
              placeholder={selected?.hasApiKey ? t("settings.imageGeneration.keyConfigured") : ""}
              onChange={(event) => setForm({ ...form, apiKey: event.target.value })}
            />
          </label>
          <div className="settings-form-actions image-generation-form-actions">
            {selected ? (
              <button
                type="button"
                className="settings-secondary-button"
                disabled={busy || settings.activeProfileId === selected.id}
                onClick={() =>
                  void run(async () => {
                    if (!window.eco) throw new Error(t("settings.imageGeneration.desktopOnly"));
                    onChange(await window.eco.activateImageGenerationProfile(selected.id));
                  })
                }
              >
                <Check size={14} aria-hidden /> {t("settings.imageGeneration.activate")}
              </button>
            ) : null}
            {selected ? (
              <button
                type="button"
                className="settings-secondary-button image-generation-danger-button"
                disabled={busy || settings.activeProfileId === selected.id || settings.profiles.length <= 1}
                title={t("common.delete")}
                aria-label={t("common.delete")}
                onClick={() =>
                  void run(async () => {
                    if (!window.eco) throw new Error(t("settings.imageGeneration.desktopOnly"));
                    onChange(await window.eco.deleteImageGenerationProfile(selected.id));
                    setSelectedId(settings.activeProfileId);
                  })
                }
              >
                <Trash2 size={14} aria-hidden />
              </button>
            ) : null}
            <button type="submit" className="settings-primary-button" disabled={busy}>
              {t("common.save")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function newProfileForm(provider: ImageGenerationProvider): ImageGenerationProfileSaveInput {
  return {
    name: "",
    provider,
    endpoint: defaultImageGenerationEndpoint(provider),
    model: defaultImageGenerationModel(provider),
    apiKey: "",
  };
}
