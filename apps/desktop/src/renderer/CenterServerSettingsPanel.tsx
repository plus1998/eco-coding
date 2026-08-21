import { ChevronLeft, Loader2, LogIn, Plus, QrCode, RefreshCw, Settings2, Smartphone, Trash2 } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { type Dispatch, type SetStateAction, useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { i18n } from "./i18n";
import type {
  CenterServerAccountAuthResult,
  CenterServerConnectionStatus,
  CenterServerCreatePairingResult,
  CenterServerDeviceBindingView,
  CenterServerDevicePresenceView,
  CenterServerSettingsInput,
  CenterServerSettingsSnapshot,
  CenterServerSettingsView,
  CenterServerSignInRequest,
  CenterServerSignUpRequest,
  CenterServerApproveVaultClaimResult,
  CenterServerRequestVaultClaimResult,
  CenterServerSubmitVaultClaimCodeResult,
  CenterServerSyncConfigResult,
  CenterServerVaultClaimView,
  CenterServerVaultStatus,
} from "../shared/center-server";
import {
  CenterServerRemoveConnectionError,
  CENTER_SERVER_EMAIL_NOT_CONFIRMED_MESSAGE,
  classifyCenterServerAuthError,
  isCenterServerReloginError,
  isLocalhostCenterServerUrl,
} from "../shared/center-server";

interface CenterServerSettingsPanelProps {
  snapshot: CenterServerSettingsSnapshot;
  busy?: boolean;
  onSave: (input: CenterServerSettingsInput) => Promise<CenterServerSettingsSnapshot>;
  onTestConnection: (input: {
    supabaseUrl: string;
    anonKey: string;
  }) => Promise<{ ok: boolean; error?: string }>;
  onSignUp: (request: CenterServerSignUpRequest) => Promise<CenterServerAccountAuthResult>;
  onSignIn: (request: CenterServerSignInRequest) => Promise<CenterServerAccountAuthResult>;
  onCreatePairing: () => Promise<CenterServerCreatePairingResult>;
  onListBindings: () => Promise<CenterServerDeviceBindingView[]>;
  onListPresence: () => Promise<CenterServerDevicePresenceView[]>;
  onRevokeBinding: (bindingId: string) => Promise<CenterServerDeviceBindingView>;
  onConnect: () => Promise<CenterServerSettingsSnapshot>;
  onDisconnect: () => Promise<CenterServerSettingsSnapshot>;
  onRemoveConnection: (options?: { forceLocal?: boolean }) => Promise<{
    settings: CenterServerSettingsSnapshot["settings"];
    status: CenterServerSettingsSnapshot["status"];
    notice?: string;
  }>;
  onGetVaultStatus: () => Promise<CenterServerVaultStatus>;
  onSyncConfig: () => Promise<CenterServerSyncConfigResult>;
  onRequestVaultClaim: () => Promise<CenterServerRequestVaultClaimResult>;
  onListPendingVaultClaims: () => Promise<CenterServerVaultClaimView[]>;
  onApproveVaultClaim: (claimId: string) => Promise<CenterServerApproveVaultClaimResult>;
  onSubmitVaultClaimCode: (code: string) => Promise<CenterServerSubmitVaultClaimCodeResult>;
  onCancelVaultClaim: () => Promise<CenterServerVaultStatus>;
}

type PanelView = "list" | "edit-server" | "edit-account";
type AccountAuthMode = "signup" | "signin";

export function CenterServerSettingsPanel({
  snapshot,
  busy,
  onSave,
  onTestConnection,
  onSignUp,
  onSignIn,
  onCreatePairing,
  onListBindings,
  onListPresence,
  onRevokeBinding,
  onDisconnect,
  onRemoveConnection,
  onGetVaultStatus,
  onSyncConfig,
  onRequestVaultClaim,
  onListPendingVaultClaims,
  onApproveVaultClaim,
  onSubmitVaultClaimCode,
  onCancelVaultClaim,
}: CenterServerSettingsPanelProps) {
  const { t } = useTranslation();
  const [view, setView] = useState<PanelView>("list");
  const [form, setForm] = useState<CenterServerSettingsInput>(() => viewToInput(snapshot.settings));
  const [authMode, setAuthMode] = useState<AccountAuthMode>("signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [pairing, setPairing] = useState<CenterServerCreatePairingResult>();
  const [bindings, setBindings] = useState<CenterServerDeviceBindingView[]>([]);
  const [presence, setPresence] = useState<CenterServerDevicePresenceView[]>([]);
  const [bindingsLoading, setBindingsLoading] = useState(false);
  const [bindingsError, setBindingsError] = useState<string>();
  const [revokingBindingId, setRevokingBindingId] = useState<string>();
  const [testing, setTesting] = useState(false);
  const [pairingBusy, setPairingBusy] = useState(false);
  const [connectionBusy, setConnectionBusy] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [serverReachable, setServerReachable] = useState(false);
  const [error, setError] = useState<string>();
  const [infoNotice, setInfoNotice] = useState<string>();
  const [vaultStatus, setVaultStatus] = useState<CenterServerVaultStatus>();
  const [pendingClaims, setPendingClaims] = useState<CenterServerVaultClaimView[]>([]);
  const [vaultBusy, setVaultBusy] = useState(false);
  const [claimCodeInput, setClaimCodeInput] = useState("");
  const [approvalCode, setApprovalCode] = useState<string>();
  const onListBindingsRef = useRef(onListBindings);
  const onListPresenceRef = useRef(onListPresence);
  onListBindingsRef.current = onListBindings;
  onListPresenceRef.current = onListPresence;

  const registered = snapshot.settings.hasDeviceSecret || snapshot.settings.hasRefreshToken;
  const projectUrl = form.supabaseUrl?.trim() || form.serverUrl?.trim() || "";
  const hasUrl = projectUrl.length > 0;
  const hasAnonKeyInput = Boolean(form.anonKey?.trim()) || snapshot.settings.hasAnonKey;
  // Binding list refresh must not disable the connection switch / delete action.
  const actionBusy =
    busy || testing || pairingBusy || connectionBusy || saveBusy || authBusy || vaultBusy;
  const isLive = snapshot.status.state === "connected";
  const isConnecting = snapshot.status.state === "connecting";
  const needsReauth =
    registered &&
    snapshot.status.state === "error" &&
    isCenterServerReloginError(snapshot.status.lastError);
  const serverUrl = projectUrl || snapshot.settings.supabaseUrl || snapshot.settings.serverUrl;
  const deviceLabel = snapshot.settings.deviceName || t("settings.center.remoteService");
  const activeBindings = bindings.filter((binding) => binding.revokedAt == null);
  const hasVaultKey = vaultStatus?.hasVaultKey ?? snapshot.settings.hasVaultKey;

  const refreshVault = useCallback(async () => {
    if (!registered || !isLive) {
      setVaultStatus(undefined);
      setPendingClaims([]);
      return;
    }
    try {
      const [status, claims] = await Promise.all([
        onGetVaultStatus(),
        onListPendingVaultClaims().catch(() => [] as CenterServerVaultClaimView[]),
      ]);
      setVaultStatus(status);
      setPendingClaims(claims);
      if (status.approvalCode) {
        setApprovalCode(status.approvalCode);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }, [isLive, onGetVaultStatus, onListPendingVaultClaims, registered]);

  const refreshBindings = useCallback(async (options?: { showLoading?: boolean }) => {
    if (!registered || !isLive) {
      setBindings([]);
      setPresence([]);
      return;
    }
    const showLoading = options?.showLoading !== false;
    if (showLoading) {
      setBindingsLoading(true);
    }
    setBindingsError(undefined);
    try {
      const [nextBindings, nextPresence] = await Promise.all([
        onListBindingsRef.current(),
        onListPresenceRef.current(),
      ]);
      setBindings(nextBindings);
      setPresence(nextPresence);
    } catch (caught) {
      setBindingsError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      if (showLoading) {
        setBindingsLoading(false);
      }
    }
  }, [isLive, registered]);

  useEffect(() => {
    setForm(viewToInput(snapshot.settings));
  }, [snapshot.settings]);

  useEffect(() => {
    void refreshBindings();
  }, [refreshBindings]);

  useEffect(() => {
    void refreshVault();
  }, [refreshVault]);

  useEffect(() => {
    if (!registered || !isLive) {
      return;
    }
    const timer = window.setInterval(() => {
      void refreshVault();
    }, 20_000);
    return () => window.clearInterval(timer);
  }, [isLive, registered, refreshVault]);

  useEffect(() => {
    if (!snapshot.status.lastPresenceChangedAt) {
      return;
    }
    void refreshBindings({ showLoading: false });
    void refreshVault();
  }, [refreshBindings, refreshVault, snapshot.status.lastPresenceChangedAt]);

  useEffect(() => {
    if (!pairing || !isLive) {
      return;
    }
    const timer = window.setInterval(() => {
      void refreshBindings({ showLoading: false });
    }, 3_000);
    return () => window.clearInterval(timer);
  }, [isLive, pairing, refreshBindings]);

  async function handleTestConnection() {
    setError(undefined);
    setTesting(true);
    try {
      if (!hasUrl) {
        setServerReachable(false);
        setError(t("settings.center.serverRequired"));
        return;
      }
      if (!hasAnonKeyInput) {
        setServerReachable(false);
        setError(t("settings.center.anonKeyRequired"));
        return;
      }
      const result = await onTestConnection({
        supabaseUrl: projectUrl,
        anonKey: form.anonKey?.trim() ?? "",
      });
      if (result.ok) {
        setServerReachable(true);
      } else {
        setServerReachable(false);
        setError(result.error ?? t("settings.center.unreachable"));
      }
    } catch (caught) {
      setServerReachable(false);
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setTesting(false);
    }
  }

  async function handleSaveServer() {
    const deviceName = form.deviceName?.trim();
    if (!hasUrl) {
      setError(t("settings.center.serverRequired"));
      return;
    }
    if (!hasAnonKeyInput) {
      setError(t("settings.center.anonKeyRequired"));
      return;
    }
    if (!deviceName) {
      setError(t("settings.center.deviceRequired"));
      return;
    }
    if (!registered && !serverReachable) {
      setError(t("settings.center.testFirst"));
      return;
    }

    setError(undefined);
    setSaveBusy(true);
    try {
      await onSave({
        ...form,
        enabled: registered ? form.enabled : false,
        supabaseUrl: projectUrl,
        serverUrl: projectUrl,
        deviceName,
        anonKey: form.anonKey?.trim() ? form.anonKey.trim() : "",
      });
      if (registered) {
        setView("list");
      } else {
        setView("edit-account");
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSaveBusy(false);
    }
  }

  async function handleAccountAuth() {
    const deviceName = form.deviceName?.trim() || snapshot.settings.deviceName;
    if (!email.trim() || !password.trim() || !deviceName) {
      setError(t("settings.center.credentialsRequired"));
      return;
    }
    if (!projectUrl) {
      setError(t("settings.center.serverRequired"));
      return;
    }
    setError(undefined);
    setInfoNotice(undefined);
    setAuthBusy(true);
    try {
      const anonKey = form.anonKey?.trim() ?? "";
      if (authMode === "signup") {
        const result = await onSignUp({
          supabaseUrl: projectUrl,
          anonKey,
          email: email.trim(),
          password,
          deviceName,
          ...(displayName.trim() ? { displayName: displayName.trim() } : {}),
        });
        setPassword("");
        if (result.emailConfirmationRequired) {
          setAuthMode("signin");
          setInfoNotice(t("settings.center.emailConfirmRequired"));
          return;
        }
      } else {
        await onSignIn({
          supabaseUrl: projectUrl,
          anonKey,
          email: email.trim(),
          password,
          deviceName,
        });
        setPassword("");
      }
      setView("list");
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      if (
        message === CENTER_SERVER_EMAIL_NOT_CONFIRMED_MESSAGE ||
        /email\s*not\s*confirmed/i.test(message)
      ) {
        setError(t("settings.center.emailNotConfirmed"));
      } else {
        setError(message);
      }
    } finally {
      setAuthBusy(false);
    }
  }

  async function handleToggle(enabled: boolean) {
    setError(undefined);
    setConnectionBusy(true);
    try {
      const nextForm = { ...form, enabled };
      setForm(nextForm);
      const nextSnapshot = await onSave(nextForm);
      if (!enabled) {
        await onDisconnect();
      } else if (nextSnapshot.status.state === "error") {
        setError(nextSnapshot.status.lastError ?? t("settings.center.connectionFailed"));
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setConnectionBusy(false);
    }
  }

  async function handleCreatePairing() {
    setError(undefined);
    setPairingBusy(true);
    try {
      setPairing(await onCreatePairing());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setPairingBusy(false);
    }
  }

  async function handleSyncConfig() {
    setError(undefined);
    setVaultBusy(true);
    try {
      const result = await onSyncConfig();
      setVaultStatus(result.vaultStatus);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setVaultBusy(false);
    }
  }

  async function handleRequestVaultClaim() {
    setError(undefined);
    setVaultBusy(true);
    try {
      await onRequestVaultClaim();
      await refreshVault();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setVaultBusy(false);
    }
  }

  async function handleApproveVaultClaim(claimId: string) {
    setError(undefined);
    setVaultBusy(true);
    try {
      const result = await onApproveVaultClaim(claimId);
      setApprovalCode(result.code);
      await refreshVault();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setVaultBusy(false);
    }
  }

  async function handleSubmitVaultClaimCode() {
    setError(undefined);
    setVaultBusy(true);
    try {
      await onSubmitVaultClaimCode(claimCodeInput);
      setClaimCodeInput("");
      await refreshVault();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setVaultBusy(false);
    }
  }

  async function handleCancelVaultClaim() {
    setError(undefined);
    setVaultBusy(true);
    try {
      setVaultStatus(await onCancelVaultClaim());
      setClaimCodeInput("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setVaultBusy(false);
    }
  }

  async function handleRevokeBinding(binding: CenterServerDeviceBindingView) {
    const mobile = presence.find((device) => device.id === binding.mobileDeviceId);
    const mobileLabel = mobile?.name ?? shortenDeviceId(binding.mobileDeviceId);
    const confirmed = window.confirm(t("settings.center.confirmUnbind", { name: mobileLabel }));
    if (!confirmed) {
      return;
    }
    setBindingsError(undefined);
    setRevokingBindingId(binding.id);
    try {
      await onRevokeBinding(binding.id);
      await refreshBindings();
    } catch (caught) {
      setBindingsError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setRevokingBindingId(undefined);
    }
  }

  function buildForceLocalConfirmMessage(error: unknown): string {
    const recovery =
      error instanceof CenterServerRemoveConnectionError
        ? error.recovery
        : classifyCenterServerAuthError(error instanceof Error ? error.message : String(error));
    const detail = error instanceof Error ? error.message : String(error);
    if (recovery === "account_unusable") {
      return t("settings.center.remove.accountUnusable", { detail });
    }
    if (recovery === "relogin") {
      return t("settings.center.remove.relogin", { detail });
    }
    return t("settings.center.remove.unreachable", { detail });
  }

  async function handleRemoveConnection(forceLocal = false) {
    if (!forceLocal) {
      const confirmed = window.confirm(t("settings.center.confirmRemove", { name: deviceLabel }));
      if (!confirmed) {
        return;
      }
    }

    setError(undefined);
    setConnectionBusy(true);
    try {
      const result = await onRemoveConnection(forceLocal ? { forceLocal: true } : undefined);
      setForm(viewToInput(result.settings));
      setPairing(undefined);
      setBindings([]);
      setPresence([]);
      setView("list");
      if (result.notice) {
        setError(result.notice);
      }
    } catch (caught) {
      const forceConfirmed = window.confirm(buildForceLocalConfirmMessage(caught));
      if (forceConfirmed) {
        await handleRemoveConnection(true);
        return;
      }
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setConnectionBusy(false);
    }
  }

  function openSetup() {
    setError(undefined);
    setServerReachable(
      Boolean((snapshot.settings.supabaseUrl || snapshot.settings.serverUrl).trim()) &&
        snapshot.settings.hasAnonKey,
    );
    setView("edit-server");
  }

  function openServerEditor() {
    setError(undefined);
    setServerReachable(true);
    setView("edit-server");
  }

  function openReauth() {
    setError(undefined);
    setAuthMode("signin");
    setView("edit-account");
  }

  if (view === "edit-server") {
    return (
      <div className="cs">
        <ServerEditor
          form={form}
          setForm={setForm}
          registered={registered}
          serverReachable={serverReachable}
          error={error}
          busy={actionBusy}
          testing={testing}
          onBack={() => setView("list")}
          onTestConnection={() => void handleTestConnection()}
          onSave={() => void handleSaveServer()}
          onServerUrlChange={() => setServerReachable(false)}
        />
      </div>
    );
  }

  if (view === "edit-account") {
    return (
      <div className="cs">
        <AccountEditor
          serverUrl={serverUrl}
          registered={registered}
          authMode={authMode}
          setAuthMode={setAuthMode}
          email={email}
          setEmail={setEmail}
          password={password}
          setPassword={setPassword}
          displayName={displayName}
          setDisplayName={setDisplayName}
          error={error}
          infoNotice={infoNotice}
          busy={actionBusy}
          onBack={() => (registered ? setView("list") : setView("edit-server"))}
          onSubmit={() => void handleAccountAuth()}
        />
      </div>
    );
  }

  return (
    <div className="cs">
      <header className="cs-head">
        <h1 className="cs-title">{t("settings.center.title")}</h1>
        <p className="cs-desc">{t("settings.center.description")}</p>
      </header>

      {error ? <p className="cs-error">{error}</p> : null}

      {!registered ? (
        <div className="cs-empty">
          <p className="cs-empty-text">{t("settings.center.empty")}</p>
          <button type="button" className="cs-btn" disabled={actionBusy} onClick={openSetup}>
            <Plus size={15} strokeWidth={1.75} />
            {t("settings.center.add")}
          </button>
        </div>
      ) : (
        <div className="cs-card">
          <div className="cs-card-row">
            <div className="cs-service">
              <span className={`cs-dot cs-dot--${statusDotKind(snapshot.status)}`} aria-hidden />
              <div className="cs-service-copy">
                <span className="cs-service-name">{deviceLabel}</span>
                <span className="cs-service-url">{serverUrl}</span>
                <StatusMeta status={snapshot.status} needsReauth={needsReauth} />
              </div>
            </div>
            <div className="cs-card-tools">
              {needsReauth ? (
                <button
                  type="button"
                  className="cs-icon-btn is-warn"
                  onClick={openReauth}
                  aria-label={t("settings.center.relogin")}
                  title={t("settings.center.relogin")}
                  disabled={actionBusy}
                >
                  <LogIn size={16} strokeWidth={1.75} />
                </button>
              ) : null}
              <button
                type="button"
                className="cs-icon-btn"
                onClick={openServerEditor}
                aria-label={t("settings.center.configure")}
                disabled={actionBusy}
              >
                <Settings2 size={16} strokeWidth={1.75} />
              </button>
              <label
                className="cs-switch"
                title={form.enabled ? t("common.enabled") : t("common.disabled")}
              >
                <input
                  type="checkbox"
                  checked={form.enabled}
                  disabled={actionBusy || isConnecting}
                  onChange={(event) => void handleToggle(event.target.checked)}
                />
                <span className="cs-switch-track" aria-hidden />
              </label>
            </div>
          </div>
        </div>
      )}

      {registered ? (
        <section className="cs-block">
          <button
            type="button"
            className="cs-text-action is-muted"
            disabled={actionBusy}
            onClick={() => void handleRemoveConnection()}
          >
            <Trash2 size={14} strokeWidth={1.75} />
            {t("settings.center.delete")}
          </button>
        </section>
      ) : null}

      {registered && isLive ? (
        <section className="cs-block">
          <div className="cs-block-head">
            <h2 className="cs-block-label">{t("settings.center.vault.title")}</h2>
            <button
              type="button"
              className="cs-text-action is-muted"
              disabled={actionBusy}
              onClick={() => void handleSyncConfig()}
            >
              <RefreshCw size={14} strokeWidth={1.75} className={vaultBusy ? "cs-spin" : undefined} />
              {t("settings.center.vault.syncNow")}
            </button>
          </div>
          <p className="cs-placeholder">
            {hasVaultKey
              ? t("settings.center.vault.hasKey")
              : vaultStatus?.state === "claim_pending" || vaultStatus?.activeClaimId
                ? t("settings.center.vault.claimWaiting")
                : t("settings.center.vault.needsClaim")}
            {vaultStatus?.lastSyncedAt
              ? ` · ${t("settings.center.vault.lastSynced", { time: formatLocalTime(vaultStatus.lastSyncedAt) })}`
              : null}
          </p>
          {vaultStatus?.hint && !vaultStatus.error ? (
            <p className="cs-placeholder">{vaultStatus.hint}</p>
          ) : null}
          {vaultStatus?.error ? <p className="cs-error">{vaultStatus.error}</p> : null}
          {hasVaultKey && (vaultStatus?.pendingClaimCount ?? 0) > 0 ? (
            <p className="cs-placeholder">
              {t("settings.center.vault.pendingApprovals", {
                count: vaultStatus?.pendingClaimCount ?? 0,
              })}
            </p>
          ) : null}

          {!hasVaultKey ? (
            <div className="cs-vault-actions">
              <button
                type="button"
                className="cs-btn"
                disabled={actionBusy}
                onClick={() => void handleRequestVaultClaim()}
              >
                {t("settings.center.vault.requestClaim")}
              </button>
              {vaultStatus?.activeClaimId || vaultStatus?.state === "claim_pending" ? (
                <div className="cs-vault-code-row">
                  <input
                    className="cs-input"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    placeholder={t("settings.center.vault.codePlaceholder")}
                    value={claimCodeInput}
                    onChange={(event) => setClaimCodeInput(event.target.value)}
                    disabled={actionBusy}
                  />
                  <button
                    type="button"
                    className="cs-btn"
                    disabled={actionBusy || claimCodeInput.trim().length < 6}
                    onClick={() => void handleSubmitVaultClaimCode()}
                  >
                    {t("settings.center.vault.submitCode")}
                  </button>
                  <button
                    type="button"
                    className="cs-text-action is-muted"
                    disabled={actionBusy}
                    onClick={() => void handleCancelVaultClaim()}
                  >
                    {t("common.cancel")}
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}

          {hasVaultKey && pendingClaims.length > 0 ? (
            <ul className="cs-list">
              {pendingClaims.map((claim) => (
                <li key={claim.id} className="cs-list-item">
                  <div className="cs-device-copy">
                    <span className="cs-device-name">
                      {t("settings.center.vault.pendingClaim", {
                        id: shortenDeviceId(claim.requesterDeviceId),
                      })}
                    </span>
                    <span className="cs-device-meta">
                      {t("settings.center.expires", { time: formatLocalTime(claim.expiresAt) })}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="cs-btn"
                    disabled={actionBusy}
                    onClick={() => void handleApproveVaultClaim(claim.id)}
                  >
                    {t("settings.center.vault.approve")}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}

          {approvalCode ? (
            <p className="cs-placeholder">
              {t("settings.center.vault.showCode", { code: approvalCode })}
            </p>
          ) : null}
        </section>
      ) : null}

      {registered && isLive ? (
        <section className="cs-block">
          <div className="cs-block-head">
            <h2 className="cs-block-label">{t("settings.center.boundPhones")}</h2>
            <button
              type="button"
              className="cs-text-action is-muted"
              disabled={actionBusy || bindingsLoading}
              onClick={() => void refreshBindings()}
            >
              <RefreshCw size={14} strokeWidth={1.75} className={bindingsLoading ? "cs-spin" : undefined} />
              {t("common.refresh")}
            </button>
          </div>

          {bindingsError ? <p className="cs-error">{bindingsError}</p> : null}

          {bindingsLoading && activeBindings.length === 0 ? (
            <p className="cs-placeholder">{t("common.loading")}</p>
          ) : activeBindings.length === 0 ? (
            <p className="cs-placeholder">{t("settings.center.noPhones")}</p>
          ) : (
            <ul className="cs-list">
              {activeBindings.map((binding) => {
                const mobile = presence.find((device) => device.id === binding.mobileDeviceId);
                const online = mobile?.online === true;
                const mobileLabel = formatMobileLabel(mobile, binding.mobileDeviceId);
                const mobileDetail = formatMobileDetail(mobile, binding.mobileDeviceId);
                const revoking = revokingBindingId === binding.id;
                return (
                  <li key={binding.id} className="cs-list-item">
                    <div className="cs-device">
                      <span className={`cs-dot cs-dot--${online ? "online" : "offline"}`} aria-hidden />
                      <div className="cs-device-copy">
                        <span className="cs-device-name">
                          <Smartphone size={14} strokeWidth={1.75} aria-hidden />
                          {mobileLabel}
                        </span>
                        {mobileDetail ? <span className="cs-device-meta">{mobileDetail}</span> : null}
                        <span className="cs-device-meta">
                          {t("settings.center.boundAt", {
                            status: online
                              ? t("settings.center.online")
                              : t("settings.center.offline"),
                            time: formatLocalTime(binding.createdAt),
                          })}
                        </span>
                      </div>
                    </div>
                    <button
                      type="button"
                      className="cs-text-action is-muted"
                      disabled={actionBusy || revoking}
                      onClick={() => void handleRevokeBinding(binding)}
                    >
                      {revoking
                        ? t("settings.center.revoking")
                        : t("settings.center.revoke")}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ) : null}

      {registered && isLive ? (
        <section className="cs-block">
          <div className="cs-block-head">
            <h2 className="cs-block-label">{t("settings.center.pairing")}</h2>
            <button
              type="button"
              className="cs-btn cs-btn--ghost"
              disabled={actionBusy || pairingBusy}
              onClick={() => void handleCreatePairing()}
            >
              <QrCode size={15} strokeWidth={1.75} />
              {t("settings.center.generatePairing")}
            </button>
          </div>

          {!pairing ? (
            <p className="cs-placeholder">{t("settings.center.scanHint")}</p>
          ) : (
            <div className="cs-pairing">
              {isLocalhostCenterServerUrl(snapshot.settings.supabaseUrl || snapshot.settings.serverUrl) ? (
                <p className="cs-pairing-note">
                  {t("settings.center.localhostWarning")}
                </p>
              ) : null}
              <div className="cs-pairing-qr">
                <QRCodeSVG
                  value={pairing.qrPayload}
                  size={148}
                  level="M"
                  includeMargin={false}
                  role="img"
                  aria-label={t("settings.center.qrAria", { code: pairing.code })}
                />
              </div>
              <code className="cs-pairing-code">{pairing.code}</code>
              <p className="cs-pairing-expire">
                {t("settings.center.expires", { time: formatLocalTime(pairing.expiresAt) })}
              </p>
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}

function ServerEditor({
  form,
  setForm,
  registered,
  serverReachable,
  error,
  busy,
  testing,
  onBack,
  onTestConnection,
  onSave,
  onServerUrlChange,
}: {
  form: CenterServerSettingsInput;
  setForm: Dispatch<SetStateAction<CenterServerSettingsInput>>;
  registered: boolean;
  serverReachable: boolean;
  error: string | undefined;
  busy?: boolean;
  testing: boolean;
  onBack: () => void;
  onTestConnection: () => void;
  onSave: () => void;
  onServerUrlChange: () => void;
}) {
  const { t } = useTranslation();
  const projectUrl = form.supabaseUrl ?? form.serverUrl ?? "";
  return (
    <>
      <button type="button" className="cs-back" onClick={onBack} disabled={busy}>
        <ChevronLeft size={16} strokeWidth={1.75} />
        {t("settings.mcp.back")}
      </button>

      <header className="cs-head cs-head--editor">
        <h1 className="cs-title">
          {registered ? t("settings.center.serverConfig") : t("settings.center.add")}
        </h1>
        <p className="cs-desc">{t("settings.center.editorDescription")}</p>
      </header>

      <div className="cs-form">
        <label className="cs-field">
          <span className="cs-field-label">{t("settings.center.supabaseUrl")}</span>
          <input
            className="cs-input"
            type="text"
            value={projectUrl}
            disabled={busy}
            placeholder="https://xxxx.supabase.co"
            onChange={(event) => {
              onServerUrlChange();
              setForm((current) => ({
                ...current,
                supabaseUrl: event.target.value,
                serverUrl: event.target.value,
              }));
            }}
          />
        </label>

        <label className="cs-field">
          <span className="cs-field-label">{t("settings.center.anonKey")}</span>
          <input
            className="cs-input"
            type="password"
            value={form.anonKey ?? ""}
            disabled={busy}
            placeholder={
              registered || form.anonKey === undefined
                ? t("settings.center.anonKeyKeep")
                : "eyJhbGciOi..."
            }
            autoComplete="off"
            onChange={(event) => {
              onServerUrlChange();
              setForm((current) => ({ ...current, anonKey: event.target.value }));
            }}
          />
        </label>

        <label className="cs-field">
          <span className="cs-field-label">{t("settings.center.deviceName")}</span>
          <input
            className="cs-input"
            type="text"
            value={form.deviceName ?? ""}
            disabled={busy}
            placeholder="Eco Desktop"
            onChange={(event) => setForm((current) => ({ ...current, deviceName: event.target.value }))}
          />
        </label>

        {serverReachable && !registered ? (
          <p className="cs-success">{t("settings.center.reachable")}</p>
        ) : null}
        {error ? <p className="cs-error">{error}</p> : null}

        <div className="cs-form-actions">
          <button
            type="button"
            className="cs-btn cs-btn--ghost"
            disabled={busy || !projectUrl.trim()}
            onClick={onTestConnection}
          >
            <RefreshCw size={15} strokeWidth={1.75} className={testing ? "cs-spin" : undefined} />
            {t("settings.center.test")}
          </button>
          <button type="button" className="cs-btn" disabled={busy} onClick={onSave}>
            {busy ? (
              <>
                <Loader2 size={15} strokeWidth={1.75} className="cs-spin" aria-hidden />
                {t("settings.center.saving")}
              </>
            ) : registered ? (
              t("common.save")
            ) : (
              t("settings.center.continue")
            )}
          </button>
        </div>
      </div>
    </>
  );
}

function AccountEditor({
  serverUrl,
  registered,
  authMode,
  setAuthMode,
  email,
  setEmail,
  password,
  setPassword,
  displayName,
  setDisplayName,
  error,
  infoNotice,
  busy,
  onBack,
  onSubmit,
}: {
  serverUrl: string;
  registered: boolean;
  authMode: AccountAuthMode;
  setAuthMode: (mode: AccountAuthMode) => void;
  email: string;
  setEmail: (value: string) => void;
  password: string;
  setPassword: (value: string) => void;
  displayName: string;
  setDisplayName: (value: string) => void;
  error: string | undefined;
  infoNotice: string | undefined;
  busy?: boolean;
  onBack: () => void;
  onSubmit: () => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      <button type="button" className="cs-back" onClick={onBack} disabled={busy}>
        <ChevronLeft size={16} strokeWidth={1.75} />
        {t("settings.mcp.back")}
      </button>

      <header className="cs-head cs-head--editor">
        <h1 className="cs-title">
          {registered ? t("settings.center.relogin") : t("settings.center.bindAccount")}
        </h1>
        <p className="cs-desc">
          <code className="cs-inline-code">{serverUrl}</code>
        </p>
      </header>

      <div className="cs-form">
        {!registered ? (
          <div className="cs-tabs" role="tablist" aria-label={t("settings.center.accountActions")}>
            <button
              type="button"
              role="tab"
              aria-selected={authMode === "signup"}
              className={authMode === "signup" ? "cs-tab is-active" : "cs-tab"}
              disabled={busy}
              onClick={() => setAuthMode("signup")}
            >
              {t("settings.center.signup")}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={authMode === "signin"}
              className={authMode === "signin" ? "cs-tab is-active" : "cs-tab"}
              disabled={busy}
              onClick={() => setAuthMode("signin")}
            >
              {t("settings.center.signin")}
            </button>
          </div>
        ) : null}

        {authMode === "signup" && !registered ? (
          <label className="cs-field">
            <span className="cs-field-label">{t("settings.center.displayName")}</span>
            <input
              className="cs-input"
              type="text"
              value={displayName}
              disabled={busy}
              placeholder={t("settings.center.optional")}
              onChange={(event) => setDisplayName(event.target.value)}
            />
          </label>
        ) : null}

        <label className="cs-field">
          <span className="cs-field-label">{t("settings.center.email")}</span>
          <input
            className="cs-input"
            type="email"
            autoComplete="username"
            value={email}
            disabled={busy}
            placeholder="you@example.com"
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>

        <label className="cs-field">
          <span className="cs-field-label">{t("settings.center.password")}</span>
          <input
            className="cs-input"
            type="password"
            autoComplete={authMode === "signup" ? "new-password" : "current-password"}
            value={password}
            disabled={busy}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>

        {infoNotice ? <p className="cs-placeholder">{infoNotice}</p> : null}
        {error ? <p className="cs-error">{error}</p> : null}

        <button
          type="button"
          className="cs-btn cs-btn--block"
          disabled={busy || !email.trim() || !password.trim()}
          onClick={onSubmit}
        >
          {busy ? (
            <>
              <Loader2 size={15} strokeWidth={1.75} className="cs-spin" aria-hidden />
              {authMode === "signup"
                ? t("settings.center.signingUp")
                : t("settings.center.signingIn")}
            </>
          ) : authMode === "signup" ? (
            t("settings.center.signupBind")
          ) : (
            t("settings.center.signinBind")
          )}
        </button>
      </div>
    </>
  );
}

function StatusMeta({
  status,
  needsReauth,
}: {
  status: CenterServerConnectionStatus;
  needsReauth: boolean;
}) {
  const { t } = useTranslation();
  if (needsReauth) {
    return (
      <span className="cs-service-status is-warn">
        {t("settings.center.sessionExpired")}
      </span>
    );
  }
  return (
    <span className={`cs-service-status is-${status.state}`}>
      {connectionStatusLabel(status.state)}
      {status.state === "connected" && status.connectedAt ? ` · ${formatLocalTime(status.connectedAt)}` : ""}
    </span>
  );
}

function statusDotKind(status: CenterServerConnectionStatus): string {
  if (status.state === "connected") {
    return "online";
  }
  if (status.state === "connecting") {
    return "pending";
  }
  if (status.state === "error") {
    return "error";
  }
  return "offline";
}

function viewToInput(settings: CenterServerSettingsView): CenterServerSettingsInput {
  const projectUrl = settings.supabaseUrl || settings.serverUrl;
  const input: CenterServerSettingsInput = {
    enabled: settings.enabled,
    supabaseUrl: projectUrl,
    serverUrl: projectUrl,
    anonKey: "",
    deviceName: settings.deviceName,
    deviceSecret: "",
    refreshToken: "",
  };
  if (settings.deviceId) {
    input.deviceId = settings.deviceId;
  }
  return input;
}

function connectionStatusLabel(state: CenterServerConnectionStatus["state"]): string {
  switch (state) {
    case "disabled":
      return i18n.t("settings.center.status.disabled");
    case "disconnected":
      return i18n.t("settings.center.status.disconnected");
    case "connecting":
      return i18n.t("settings.center.status.connecting");
    case "connected":
      return i18n.t("settings.center.status.connected");
    case "error":
      return i18n.t("settings.center.status.error");
  }
}

function formatLocalTime(iso: string): string {
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) {
    return iso;
  }
  return new Date(parsed).toLocaleString(i18n.resolvedLanguage);
}

function shortenDeviceId(deviceId: string): string {
  const trimmed = deviceId.trim();
  if (trimmed.length <= 12) {
    return trimmed;
  }
  return `${trimmed.slice(0, 8)}…${trimmed.slice(-4)}`;
}

function isGenericMobileName(name: string | undefined): boolean {
  if (!name) {
    return true;
  }
  const normalized = name.trim().toLowerCase();
  return normalized === "eco mobile" || normalized === "ecomobile";
}

function formatMobileLabel(mobile: CenterServerDevicePresenceView | undefined, deviceId: string): string {
  const model = mobile?.metadata?.model?.trim();
  if (model) {
    return model;
  }
  const name = mobile?.name?.trim();
  if (name && !isGenericMobileName(name)) {
    return name;
  }
  return shortenDeviceId(deviceId);
}

function formatMobileDetail(
  mobile: CenterServerDevicePresenceView | undefined,
  deviceId: string,
): string | undefined {
  const parts: string[] = [];
  const ipAddress = mobile?.metadata?.ipAddress?.trim();
  const platform = mobile?.metadata?.platform?.trim();
  if (ipAddress) {
    parts.push(ipAddress);
  }
  if (platform) {
    parts.push(platform);
  }
  parts.push(shortenDeviceId(deviceId));
  return parts.length > 0 ? parts.join(" · ") : undefined;
}
