import { Check, ChevronRight, KeyRound, Mic, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { AsrApiMode, AsrProfileSaveInput, AsrProfileSnapshot, AsrProfilesSnapshot } from "../shared/ipc";
import type { CenterServerSyncDomain, CenterServerSyncDomainResult } from "../shared/center-server";
import { SettingsSyncControl } from "./SettingsSyncControl";
import {
  isAsrInputDeviceAvailable,
  SYSTEM_DEFAULT_ASR_INPUT_DEVICE_ID,
  useAsrInputDevices,
} from "./asr-input-devices";

interface AsrSettingsPanelProps {
  snapshot: AsrProfilesSnapshot;
  busy?: boolean;
  loadError?: string;
  onSave: (input: AsrProfileSaveInput) => Promise<AsrProfileSnapshot>;
  onDelete: (profileId: string) => Promise<void>;
  onActivate: (profileId: string) => Promise<void>;
  onInputDeviceChange: (deviceId: string) => Promise<void>;
  centerServerSyncVisible?: boolean;
  onSyncDomain?: (
    domain: CenterServerSyncDomain,
    mode: "pull" | "push",
  ) => Promise<CenterServerSyncDomainResult>;
}

interface ProfileDraft {
  id?: string;
  name: string;
  endpoint: string;
  apiMode: AsrApiMode;
  model: string;
  systemPrompt: string;
  apiKey: string;
}

const emptyDraft: ProfileDraft = {
  name: "",
  endpoint: "",
  apiMode: "chat_completions",
  model: "",
  systemPrompt: "",
  apiKey: "",
};

export function resolveAsrLoadErrorDetail(
  loadError: string | undefined,
  unknownError: string,
): string | undefined {
  return loadError === undefined ? undefined : loadError || unknownError;
}

export function profileToDraft(profile: AsrProfileSnapshot): ProfileDraft {
  return {
    id: profile.id,
    name: profile.name,
    endpoint: profile.endpoint,
    apiMode: profile.apiMode,
    model: profile.model,
    systemPrompt: profile.systemPrompt,
    apiKey: "",
  };
}

/** Keep create-mode and dirty drafts across unrelated snapshot refreshes (e.g. input device). */
export function resolveAsrProfileEditorSelection(input: {
  selectedProfileId: string | undefined;
  profiles: readonly AsrProfileSnapshot[];
  activeProfileId: string;
}):
  | { action: "keep" }
  | { action: "reselect"; profileId: string | undefined; draft: ProfileDraft } {
  if (input.selectedProfileId === undefined) {
    return { action: "keep" };
  }
  if (input.profiles.some((profile) => profile.id === input.selectedProfileId)) {
    return { action: "keep" };
  }
  const nextProfile =
    input.profiles.find((profile) => profile.id === input.activeProfileId) ?? input.profiles[0];
  return {
    action: "reselect",
    profileId: nextProfile?.id,
    draft: nextProfile ? profileToDraft(nextProfile) : emptyDraft,
  };
}

export function isAsrProfileDraftDirty(
  draft: ProfileDraft,
  selected: AsrProfileSnapshot | undefined,
): boolean {
  if (!selected) {
    return Boolean(
      draft.name.trim() ||
        draft.endpoint.trim() ||
        draft.model.trim() ||
        draft.systemPrompt.trim() ||
        draft.apiKey.trim() ||
        draft.apiMode !== emptyDraft.apiMode,
    );
  }
  return (
    draft.name.trim() !== selected.name ||
    draft.endpoint.trim() !== selected.endpoint ||
    draft.apiMode !== selected.apiMode ||
    draft.model.trim() !== selected.model ||
    draft.systemPrompt !== selected.systemPrompt ||
    draft.apiKey.trim().length > 0
  );
}

export function profileStatusLine(
  profile: Pick<AsrProfileSnapshot, "apiMode" | "model" | "hasApiKey">,
  labels: { hasApiKey: string; noApiKey: string; notSet: string },
): string {
  return [
    profile.apiMode === "audio_transcriptions" ? "Audio Transcriptions" : "Chat Completions",
    profile.model.trim() || labels.notSet,
    profile.hasApiKey ? labels.hasApiKey : labels.noApiKey,
  ].join(" · ");
}

export function AsrSettingsPanel({
  snapshot,
  busy,
  loadError,
  onSave,
  onDelete,
  onActivate,
  onInputDeviceChange,
  centerServerSyncVisible = false,
  onSyncDomain,
}: AsrSettingsPanelProps) {
  const { t } = useTranslation();
  const initialProfile =
    snapshot.profiles.find((profile) => profile.id === snapshot.activeProfileId) ?? snapshot.profiles[0];
  const [selectedProfileId, setSelectedProfileId] = useState<string | undefined>(initialProfile?.id);
  const [draft, setDraft] = useState<ProfileDraft>(
    initialProfile ? profileToDraft(initialProfile) : emptyDraft,
  );
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const fallbackDeviceLabel = useCallback((index: number) => t("asr.inputDeviceNumber", { index }), [t]);
  const inputDevices = useAsrInputDevices(fallbackDeviceLabel);
  const selectedProfile = useMemo(
    () => snapshot.profiles.find((profile) => profile.id === selectedProfileId),
    [selectedProfileId, snapshot.profiles],
  );
  const creating = selectedProfileId === undefined;
  const dirty = isAsrProfileDraftDirty(draft, selectedProfile);
  const isActive = Boolean(draft.id && draft.id === snapshot.activeProfileId);
  const selectedDeviceAvailable = isAsrInputDeviceAvailable(
    snapshot.inputDeviceId ?? SYSTEM_DEFAULT_ASR_INPUT_DEVICE_ID,
    inputDevices.devices.map((device) => ({ ...device, kind: "audioinput" as const })),
  );
  const selectedDeviceLabel = (() => {
    const deviceId = snapshot.inputDeviceId ?? SYSTEM_DEFAULT_ASR_INPUT_DEVICE_ID;
    if (!deviceId) return t("asr.systemDefault");
    if (!selectedDeviceAvailable) return t("asr.inputDeviceUnavailable");
    return inputDevices.devices.find((device) => device.deviceId === deviceId)?.label ?? t("asr.systemDefault");
  })();

  useEffect(() => {
    const resolution = resolveAsrProfileEditorSelection({
      selectedProfileId,
      profiles: snapshot.profiles,
      activeProfileId: snapshot.activeProfileId,
    });
    if (resolution.action === "keep") return;
    setConfirmingDelete(false);
    setSelectedProfileId(resolution.profileId);
    setDraft(resolution.draft);
  }, [selectedProfileId, snapshot.activeProfileId, snapshot.profiles]);

  function chooseProfile(profile: AsrProfileSnapshot) {
    if (busy) return;
    setError(undefined);
    setSaved(false);
    setConfirmingDelete(false);
    setSelectedProfileId(profile.id);
    setDraft(profileToDraft(profile));
  }

  function createProfile() {
    if (busy) return;
    setError(undefined);
    setSaved(false);
    setConfirmingDelete(false);
    setSelectedProfileId(undefined);
    setDraft(emptyDraft);
  }

  async function save() {
    if (busy || !dirty) return;
    setError(undefined);
    setSaved(false);
    const name = draft.name.trim();
    if (!name) {
      setError(t("asr.profileNameRequired"));
      return;
    }
    try {
      const savedProfile = await onSave({
        ...(draft.id ? { id: draft.id } : {}),
        name,
        endpoint: draft.endpoint,
        apiMode: draft.apiMode,
        model: draft.model,
        systemPrompt: draft.systemPrompt,
        ...(draft.apiKey.trim() ? { apiKey: draft.apiKey } : {}),
      });
      setSelectedProfileId(savedProfile.id);
      setDraft(profileToDraft(savedProfile));
      setConfirmingDelete(false);
      setSaved(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("asr.saveError"));
    }
  }

  async function remove() {
    if (!draft.id || busy) return;
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      setSaved(false);
      setError(undefined);
      return;
    }
    setError(undefined);
    setSaved(false);
    try {
      await onDelete(draft.id);
      setConfirmingDelete(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("asr.deleteError"));
    }
  }

  async function activate() {
    if (!draft.id || busy || isActive) return;
    setError(undefined);
    setSaved(false);
    setConfirmingDelete(false);
    try {
      await onActivate(draft.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("asr.activateError"));
    }
  }

  async function selectInputDevice(deviceId: string) {
    if (busy) return;
    setError(undefined);
    try {
      await onInputDeviceChange(deviceId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("asr.inputDeviceSaveError"));
    }
  }

  const contextPromptNote =
    draft.apiMode === "audio_transcriptions"
      ? t("asr.contextPromptNoteTranscriptions")
      : t("asr.contextPromptNote");

  return (
    <>
      <header className="settings-page-header settings-page-header-with-action">
        <div>
          <h1>{t("asr.title")}</h1>
          <p className="settings-page-desc">{t("asr.pageSubtitle")}</p>
        </div>
        {onSyncDomain ? (
          <SettingsSyncControl
            domain="asr"
            visible={centerServerSyncVisible}
            disabled={busy}
            onSync={onSyncDomain}
          />
        ) : null}
      </header>

      <section className="settings-section asr-section">
        <div className="settings-section-head">
          <div>
            <span className="settings-section-label">{t("asr.inputDevice")}</span>
            <p className="settings-section-subtitle">{t("asr.inputDeviceSubtitle")}</p>
          </div>
          <button
            type="button"
            className="settings-icon-button asr-icon-button"
            onClick={() => void inputDevices.refresh()}
            disabled={busy || inputDevices.refreshing}
            title={t("asr.refreshInputDevices")}
            aria-label={t("asr.refreshInputDevices")}
          >
            <RefreshCw size={15} className={inputDevices.refreshing ? "asr-voice-spinner" : undefined} />
          </button>
        </div>

        <ul className="settings-rows asr-group">
          <li>
            <label className="asr-device-row">
              <span className="settings-row-main">
                <strong>{t("asr.inputSource")}</strong>
                <small>{selectedDeviceLabel}</small>
              </span>
              <span className="asr-device-control">
                <select
                  value={snapshot.inputDeviceId ?? SYSTEM_DEFAULT_ASR_INPUT_DEVICE_ID}
                  disabled={busy}
                  aria-label={t("asr.inputSource")}
                  onChange={(event) => void selectInputDevice(event.target.value)}
                >
                  <option value={SYSTEM_DEFAULT_ASR_INPUT_DEVICE_ID}>{t("asr.systemDefault")}</option>
                  {!selectedDeviceAvailable && snapshot.inputDeviceId && (
                    <option value={snapshot.inputDeviceId}>{t("asr.inputDeviceUnavailable")}</option>
                  )}
                  {inputDevices.devices.map((device) => (
                    <option key={device.deviceId} value={device.deviceId}>
                      {device.label}
                    </option>
                  ))}
                </select>
                <ChevronRight size={16} aria-hidden />
              </span>
            </label>
          </li>
        </ul>

        {!selectedDeviceAvailable && snapshot.inputDeviceId && (
          <p className="asr-inline-alert" role="alert">
            {t("asr.inputDeviceUnavailableDetail")}
          </p>
        )}
        {inputDevices.error !== undefined && (
          <p className="asr-inline-alert" role="alert">
            {t("asr.inputDeviceLoadError", {
              detail: inputDevices.error || t("asr.loadErrorUnknown"),
            })}
          </p>
        )}
      </section>

      <section className="settings-section asr-section">
        <div className="settings-section-head">
          <div>
            <span className="settings-section-label">{t("asr.profiles")}</span>
            <p className="settings-section-subtitle">{t("asr.profilesSubtitle")}</p>
          </div>
          <button
            type="button"
            className="settings-text-button asr-add-button"
            onClick={createProfile}
            disabled={busy}
          >
            <Plus size={15} aria-hidden />
            {t("asr.addProfile")}
          </button>
        </div>

        <div className="asr-workspace">
          <ul className="settings-rows asr-profile-picker" aria-label={t("asr.profiles")}>
            {snapshot.profiles.map((profile) => {
              const selected = profile.id === selectedProfileId;
              const active = profile.id === snapshot.activeProfileId;
              return (
                <li key={profile.id}>
                  <button
                    type="button"
                    className={`asr-profile-row${selected ? " selected" : ""}${active ? " is-active" : ""}`}
                    onClick={() => chooseProfile(profile)}
                    disabled={busy}
                    aria-current={selected ? "true" : undefined}
                  >
                    <span className="settings-row-main">
                      <strong>{profile.name}</strong>
                      <small>
                        {profileStatusLine(profile, {
                          hasApiKey: t("asr.hasApiKey"),
                          noApiKey: t("asr.noApiKey"),
                          notSet: t("asr.notSet"),
                        })}
                      </small>
                    </span>
                    <span className="asr-profile-row-trail">
                      {active ? (
                        <span className="asr-active-pill">
                          <Check size={12} strokeWidth={2.6} aria-hidden />
                          {t("asr.active")}
                        </span>
                      ) : null}
                      <ChevronRight size={16} aria-hidden />
                    </span>
                  </button>
                </li>
              );
            })}
            {!snapshot.profiles.length && (
              <li className="asr-profile-empty">
                <span className="settings-row-empty">{t("asr.noProfiles")}</span>
              </li>
            )}
            {creating && (
              <li>
                <div className="asr-profile-row selected is-draft" aria-current="true">
                  <span className="settings-row-main">
                    <strong>{draft.name.trim() || t("asr.newProfile")}</strong>
                    <small>{t("asr.newProfileHint")}</small>
                  </span>
                  <span className="asr-profile-row-trail">
                    <ChevronRight size={16} aria-hidden />
                  </span>
                </div>
              </li>
            )}
          </ul>

          <div className="asr-editor-card">
            <div className="asr-editor-card-head">
              <div className="asr-editor-card-title">
                <span className="asr-editor-icon" aria-hidden>
                  <Mic size={16} />
                </span>
                <div>
                  <strong>{creating ? t("asr.newProfile") : t("asr.editProfile")}</strong>
                  <small>
                    {isActive
                      ? t("asr.activeRecordingProfile")
                      : creating
                        ? t("asr.newProfileHint")
                        : t("asr.inactiveRecordingProfile")}
                  </small>
                </div>
              </div>
              {!creating && !isActive && draft.id && (
                <button
                  type="button"
                  className="settings-secondary-button asr-use-button"
                  onClick={() => void activate()}
                  disabled={busy}
                >
                  {t("asr.useForRecording")}
                </button>
              )}
            </div>

            <div className="asr-editor-fields">
              <label className="asr-field">
                <span>{t("asr.profileName")}</span>
                <input
                  value={draft.name}
                  onChange={(event) => {
                    setSaved(false);
                    setConfirmingDelete(false);
                    setDraft((current) => ({ ...current, name: event.target.value }));
                  }}
                  disabled={busy}
                  required
                  placeholder={t("asr.profileNamePlaceholder")}
                  autoComplete="off"
                />
              </label>

              <div className="asr-field">
                <span>{t("asr.apiMode")}</span>
                <div className="settings-segmented-control asr-segmented" role="group" aria-label={t("asr.apiMode")}>
                  <button
                    type="button"
                    aria-pressed={draft.apiMode === "chat_completions"}
                    className={draft.apiMode === "chat_completions" ? "active" : undefined}
                    onClick={() => {
                      setSaved(false);
                      setConfirmingDelete(false);
                      setDraft((current) => ({ ...current, apiMode: "chat_completions" }));
                    }}
                    disabled={busy}
                  >
                    {t("asr.apiModeChat")}
                  </button>
                  <button
                    type="button"
                    aria-pressed={draft.apiMode === "audio_transcriptions"}
                    className={draft.apiMode === "audio_transcriptions" ? "active" : undefined}
                    onClick={() => {
                      setSaved(false);
                      setConfirmingDelete(false);
                      setDraft((current) => ({ ...current, apiMode: "audio_transcriptions" }));
                    }}
                    disabled={busy}
                  >
                    {t("asr.apiModeTranscriptions")}
                  </button>
                </div>
                <small>
                  {draft.apiMode === "audio_transcriptions" ? t("asr.subtitleTranscriptions") : t("asr.subtitleChat")}
                </small>
              </div>

              <label className="asr-field">
                <span>{t("asr.baseUrl")}</span>
                <input
                  value={draft.endpoint}
                  onChange={(event) => {
                    setSaved(false);
                    setConfirmingDelete(false);
                    setDraft((current) => ({ ...current, endpoint: event.target.value }));
                  }}
                  disabled={busy}
                  placeholder="https://"
                  autoComplete="off"
                  spellCheck={false}
                />
              </label>

              <label className="asr-field">
                <span className="asr-field-label-row">
                  <span>{t("asr.apiKey")}</span>
                  {selectedProfile?.hasApiKey ? <em>{t("asr.saved")}</em> : null}
                </span>
                <span className="asr-secure-input">
                  <KeyRound size={15} aria-hidden />
                  <input
                    type="password"
                    value={draft.apiKey}
                    onChange={(event) => {
                      setSaved(false);
                      setConfirmingDelete(false);
                      setDraft((current) => ({ ...current, apiKey: event.target.value }));
                    }}
                    placeholder={selectedProfile?.hasApiKey ? t("asr.keepKey") : t("asr.enterKey")}
                    autoComplete="off"
                    disabled={busy || !snapshot.apiKeyEncryptionAvailable}
                  />
                </span>
              </label>

              <label className="asr-field">
                <span>{t("asr.model")}</span>
                <input
                  value={draft.model}
                  onChange={(event) => {
                    setSaved(false);
                    setConfirmingDelete(false);
                    setDraft((current) => ({ ...current, model: event.target.value }));
                  }}
                  disabled={busy}
                  placeholder="qwen3-asr-flash"
                  autoComplete="off"
                  spellCheck={false}
                />
              </label>

              <label className="asr-field">
                <span>{t("asr.contextPrompt")}</span>
                <textarea
                  value={draft.systemPrompt}
                  onChange={(event) => {
                    setSaved(false);
                    setConfirmingDelete(false);
                    setDraft((current) => ({ ...current, systemPrompt: event.target.value }));
                  }}
                  rows={4}
                  disabled={busy}
                />
                <small>{contextPromptNote}</small>
              </label>
            </div>

            {!snapshot.apiKeyEncryptionAvailable && (
              <p className="asr-inline-alert" role="status">
                {t("asr.encryptionUnavailable")}
              </p>
            )}
            {loadError !== undefined && (
              <p className="asr-inline-alert" role="alert">
                {t("asr.loadError", {
                  detail: resolveAsrLoadErrorDetail(loadError, t("asr.loadErrorUnknown")),
                })}
              </p>
            )}
            {error && (
              <p className="asr-inline-alert" role="alert">
                {error}
              </p>
            )}
            {saved && !dirty && (
              <p className="asr-inline-success" role="status">
                {t("asr.savedMessage")}
              </p>
            )}

            <div className="asr-editor-actions">
              <button
                type="button"
                className="settings-primary-button"
                onClick={() => void save()}
                disabled={busy || !dirty}
              >
                {t("asr.save")}
              </button>

              {!creating && draft.id && (
                confirmingDelete ? (
                  <div className="asr-delete-confirm" role="group" aria-label={t("asr.deleteConfirm")}>
                    <span>{t("asr.deleteConfirm")}</span>
                    <button
                      type="button"
                      className="settings-danger-button"
                      onClick={() => void remove()}
                      disabled={busy}
                    >
                      {t("asr.deleteConfirmAction")}
                    </button>
                    <button
                      type="button"
                      className="settings-text-button"
                      onClick={() => setConfirmingDelete(false)}
                      disabled={busy}
                    >
                      {t("asr.deleteCancel")}
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="settings-text-button asr-delete-text"
                    onClick={() => void remove()}
                    disabled={busy}
                  >
                    <Trash2 size={14} aria-hidden />
                    {t("asr.deleteProfile")}
                  </button>
                )
              )}
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
