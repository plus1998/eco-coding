import { KeyRound, Save } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { AsrApiMode, AsrSettingsInput, AsrSettingsSnapshot } from "../shared/ipc";

interface AsrSettingsPanelProps {
  snapshot: AsrSettingsSnapshot;
  busy?: boolean;
  loadError?: string;
  onSave: (input: AsrSettingsInput) => Promise<void>;
}

export function resolveAsrLoadErrorDetail(loadError: string | undefined, unknownError: string): string | undefined {
  return loadError === undefined ? undefined : loadError || unknownError;
}

export function AsrSettingsPanel({ snapshot, busy, loadError, onSave }: AsrSettingsPanelProps) {
  const { t } = useTranslation();
  const [endpoint, setEndpoint] = useState(snapshot.endpoint);
  const [apiMode, setApiMode] = useState<AsrApiMode>(snapshot.apiMode);
  const [model, setModel] = useState(snapshot.model);
  const [systemPrompt, setSystemPrompt] = useState(snapshot.systemPrompt);
  const [apiKey, setApiKey] = useState("");
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setEndpoint(snapshot.endpoint);
    setApiMode(snapshot.apiMode);
    setModel(snapshot.model);
    setSystemPrompt(snapshot.systemPrompt);
  }, [snapshot.endpoint, snapshot.apiMode, snapshot.model, snapshot.systemPrompt]);

  async function save() {
    setError(undefined);
    setSaved(false);
    try {
      await onSave({ endpoint, apiMode, model, systemPrompt, ...(apiKey.trim() ? { apiKey } : {}) });
      setApiKey("");
      setSaved(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("asr.saveError"));
    }
  }

  const subtitle =
    apiMode === "audio_transcriptions" ? t("asr.subtitleTranscriptions") : t("asr.subtitleChat");
  const contextPromptNote =
    apiMode === "audio_transcriptions" ? t("asr.contextPromptNoteTranscriptions") : t("asr.contextPromptNote");

  return (
    <section className="settings-section">
      <div className="settings-section-head">
        <span className="settings-section-label">{t("asr.title")}</span>
        <p className="settings-section-subtitle">{subtitle}</p>
      </div>
      <div className="settings-field">
        <span>{t("asr.apiMode")}</span>
        <div className="settings-segmented-control" role="radiogroup" aria-label={t("asr.apiMode")}>
          <button
            type="button"
            role="radio"
            aria-checked={apiMode === "chat_completions"}
            className={apiMode === "chat_completions" ? "active" : undefined}
            onClick={() => setApiMode("chat_completions")}
            disabled={busy}
          >
            {t("asr.apiModeChat")}
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={apiMode === "audio_transcriptions"}
            className={apiMode === "audio_transcriptions" ? "active" : undefined}
            onClick={() => setApiMode("audio_transcriptions")}
            disabled={busy}
          >
            {t("asr.apiModeTranscriptions")}
          </button>
        </div>
      </div>
      <label className="settings-field">
        <span>{t("asr.baseUrl")}</span>
        <input value={endpoint} onChange={(event) => setEndpoint(event.target.value)} disabled={busy} />
      </label>
      <label className="settings-field">
        <span>{t("asr.apiKey")} {snapshot.hasApiKey ? `(${t("asr.saved")})` : ""}</span>
        <span className="settings-input-with-icon">
          <KeyRound size={15} aria-hidden />
          <input
            type="password"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder={snapshot.hasApiKey ? t("asr.keepKey") : t("asr.enterKey")}
            autoComplete="off"
            disabled={busy || !snapshot.apiKeyEncryptionAvailable}
          />
        </span>
      </label>
      <label className="settings-field">
        <span>{t("asr.contextPrompt")}</span>
        <textarea value={systemPrompt} onChange={(event) => setSystemPrompt(event.target.value)} rows={4} disabled={busy} />
        <small>{contextPromptNote}</small>
      </label>
      <label className="settings-field">
        <span>{t("asr.model")}</span>
        <input value={model} onChange={(event) => setModel(event.target.value)} disabled={busy} />
      </label>
      {!snapshot.apiKeyEncryptionAvailable && (
        <p className="settings-error">{t("asr.encryptionUnavailable")}</p>
      )}
      {loadError !== undefined && (
        <p className="settings-error" role="alert">
          {t("asr.loadError", {
            detail: resolveAsrLoadErrorDetail(loadError, t("asr.loadErrorUnknown")),
          })}
        </p>
      )}
      {error && <p className="settings-error" role="alert">{error}</p>}
      {saved && <p className="settings-success" role="status">{t("asr.savedMessage")}</p>}
      <button type="button" className="settings-primary-button" onClick={() => void save()} disabled={busy}>
        <Save size={15} aria-hidden />
        {t("asr.save")}
      </button>
    </section>
  );
}
