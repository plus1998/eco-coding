import { ChevronLeft, LogIn, Plus, QrCode, RefreshCw, Settings2, Smartphone } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { type Dispatch, type SetStateAction, useCallback, useEffect, useState } from "react";
import type {
  CenterServerConnectionStatus,
  CenterServerCreatePairingResult,
  CenterServerDeviceBindingView,
  CenterServerDevicePresenceView,
  CenterServerSettingsInput,
  CenterServerSettingsSnapshot,
  CenterServerSettingsView,
  CenterServerSignInRequest,
  CenterServerSignUpRequest,
} from "../shared/center-server";
import { isCenterServerAuthCredentialError, isLocalhostCenterServerUrl } from "../shared/center-server";

interface CenterServerSettingsPanelProps {
  snapshot: CenterServerSettingsSnapshot;
  busy?: boolean;
  onSave: (input: CenterServerSettingsInput) => Promise<CenterServerSettingsSnapshot>;
  onTestConnection: (serverUrl: string) => Promise<{ ok: boolean; error?: string }>;
  onSignUp: (request: CenterServerSignUpRequest) => Promise<CenterServerSettingsSnapshot>;
  onSignIn: (request: CenterServerSignInRequest) => Promise<CenterServerSettingsSnapshot>;
  onCreatePairing: () => Promise<CenterServerCreatePairingResult>;
  onListBindings: () => Promise<CenterServerDeviceBindingView[]>;
  onListPresence: () => Promise<CenterServerDevicePresenceView[]>;
  onRevokeBinding: (bindingId: string) => Promise<CenterServerDeviceBindingView>;
  onConnect: () => Promise<CenterServerSettingsSnapshot>;
  onDisconnect: () => Promise<CenterServerSettingsSnapshot>;
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
}: CenterServerSettingsPanelProps) {
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
  const [serverReachable, setServerReachable] = useState(false);
  const [error, setError] = useState<string>();

  const registered = snapshot.settings.hasDeviceSecret || snapshot.settings.hasRefreshToken;
  const hasUrl = form.serverUrl.trim().length > 0;
  const actionBusy = busy || testing || pairingBusy || connectionBusy || bindingsLoading;
  const isLive = snapshot.status.state === "connected";
  const isConnecting = snapshot.status.state === "connecting";
  const needsReauth =
    registered &&
    snapshot.status.state === "error" &&
    isCenterServerAuthCredentialError(snapshot.status.lastError);
  const serverUrl = form.serverUrl || snapshot.settings.serverUrl;
  const deviceLabel = snapshot.settings.deviceName || "远程服务";
  const activeBindings = bindings.filter((binding) => binding.revokedAt == null);

  const refreshBindings = useCallback(async () => {
    if (!registered || !isLive) {
      setBindings([]);
      setPresence([]);
      return;
    }
    setBindingsLoading(true);
    setBindingsError(undefined);
    try {
      const [nextBindings, nextPresence] = await Promise.all([onListBindings(), onListPresence()]);
      setBindings(nextBindings);
      setPresence(nextPresence);
    } catch (caught) {
      setBindingsError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBindingsLoading(false);
    }
  }, [isLive, onListBindings, onListPresence, registered]);

  useEffect(() => {
    setForm(viewToInput(snapshot.settings));
  }, [snapshot.settings]);

  useEffect(() => {
    void refreshBindings();
  }, [refreshBindings]);

  useEffect(() => {
    if (!snapshot.status.lastPresenceChangedAt) {
      return;
    }
    void refreshBindings();
  }, [refreshBindings, snapshot.status.lastPresenceChangedAt]);

  useEffect(() => {
    if (!pairing || !isLive) {
      return;
    }
    const timer = window.setInterval(() => {
      void refreshBindings();
    }, 3_000);
    return () => window.clearInterval(timer);
  }, [isLive, pairing, refreshBindings]);

  async function handleTestConnection() {
    setError(undefined);
    setTesting(true);
    try {
      const result = await onTestConnection(form.serverUrl);
      if (result.ok) {
        setServerReachable(true);
      } else {
        setServerReachable(false);
        setError(result.error ?? "无法访问服务，请检查地址后重试。");
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
      setError("请填写服务地址。");
      return;
    }
    if (!deviceName) {
      setError("请填写本机名称。");
      return;
    }
    if (!registered && !serverReachable) {
      setError("请先测试服务可达性。");
      return;
    }

    setError(undefined);
    try {
      await onSave({
        ...form,
        enabled: registered ? form.enabled : false,
        serverUrl: form.serverUrl.trim(),
        deviceName,
      });
      if (registered) {
        setView("list");
      } else {
        setView("edit-account");
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  async function handleAccountAuth() {
    const deviceName = form.deviceName?.trim() || snapshot.settings.deviceName;
    if (!email.trim() || !password.trim() || !deviceName) {
      setError("请填写邮箱和密码。");
      return;
    }
    setError(undefined);
    try {
      if (authMode === "signup") {
        await onSignUp({
          serverUrl: form.serverUrl,
          email: email.trim(),
          password,
          deviceName,
          ...(displayName.trim() ? { displayName: displayName.trim() } : {}),
        });
        setPassword("");
      } else {
        await onSignIn({
          serverUrl: form.serverUrl,
          email: email.trim(),
          password,
          deviceName,
        });
        setPassword("");
      }
      setView("list");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
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
        setError(nextSnapshot.status.lastError ?? "连接失败。");
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

  async function handleRevokeBinding(binding: CenterServerDeviceBindingView) {
    const mobile = presence.find((device) => device.id === binding.mobileDeviceId);
    const mobileLabel = mobile?.name ?? shortenDeviceId(binding.mobileDeviceId);
    const confirmed = window.confirm(
      `确定解绑「${mobileLabel}」？\n解绑后该手机将无法远程操控本机，需重新扫码配对。`,
    );
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

  function openSetup() {
    setError(undefined);
    setServerReachable(Boolean(snapshot.settings.serverUrl.trim()));
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
        <h1 className="cs-title">连接</h1>
        <p className="cs-desc">远程 Eco 服务，同步会话并远程控制本机。</p>
      </header>

      {error ? <p className="cs-error">{error}</p> : null}

      {!registered ? (
        <div className="cs-empty">
          <p className="cs-empty-text">尚未配置远程服务</p>
          <button type="button" className="cs-btn" disabled={actionBusy} onClick={openSetup}>
            <Plus size={15} strokeWidth={1.75} />
            添加连接
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
                  aria-label="重新登录"
                  title="重新登录"
                  disabled={actionBusy}
                >
                  <LogIn size={16} strokeWidth={1.75} />
                </button>
              ) : null}
              <button
                type="button"
                className="cs-icon-btn"
                onClick={openServerEditor}
                aria-label="配置"
                disabled={actionBusy}
              >
                <Settings2 size={16} strokeWidth={1.75} />
              </button>
              <label className="cs-switch" title={form.enabled ? "已启用" : "已禁用"}>
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

      {registered && isLive ? (
        <section className="cs-block">
          <div className="cs-block-head">
            <h2 className="cs-block-label">已绑定手机</h2>
            <button
              type="button"
              className="cs-text-action is-muted"
              disabled={actionBusy}
              onClick={() => void refreshBindings()}
            >
              <RefreshCw size={14} strokeWidth={1.75} className={bindingsLoading ? "cs-spin" : undefined} />
              刷新
            </button>
          </div>

          {bindingsError ? <p className="cs-error">{bindingsError}</p> : null}

          {bindingsLoading && activeBindings.length === 0 ? (
            <p className="cs-placeholder">加载中…</p>
          ) : activeBindings.length === 0 ? (
            <p className="cs-placeholder">暂无绑定手机，生成配对码后扫码绑定。</p>
          ) : (
            <ul className="cs-list">
              {activeBindings.map((binding) => {
                const mobile = presence.find((device) => device.id === binding.mobileDeviceId);
                const online = mobile?.online === true;
                const mobileLabel = formatMobileLabel(mobile, binding.mobileDeviceId);
                const mobileDetail = formatMobileDetail(mobile);
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
                          {online ? "在线" : "离线"} · 绑定于 {formatLocalTime(binding.createdAt)}
                        </span>
                      </div>
                    </div>
                    <button
                      type="button"
                      className="cs-text-action is-muted"
                      disabled={actionBusy || revoking}
                      onClick={() => void handleRevokeBinding(binding)}
                    >
                      {revoking ? "解绑中" : "解绑"}
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
            <h2 className="cs-block-label">手机配对</h2>
            <button
              type="button"
              className="cs-btn cs-btn--ghost"
              disabled={actionBusy || pairingBusy}
              onClick={() => void handleCreatePairing()}
            >
              <QrCode size={15} strokeWidth={1.75} />
              生成配对码
            </button>
          </div>

          {!pairing ? (
            <p className="cs-placeholder">Eco App 扫码即可绑定本机。</p>
          ) : (
            <div className="cs-pairing">
              {isLocalhostCenterServerUrl(snapshot.settings.serverUrl) ? (
                <p className="cs-pairing-note">
                  localhost 手机无法访问，请改用局域网 IP 后重新生成。
                </p>
              ) : null}
              <div className="cs-pairing-qr">
                <QRCodeSVG
                  value={pairing.qrPayload}
                  size={148}
                  level="M"
                  includeMargin={false}
                  role="img"
                  aria-label={`配对二维码 ${pairing.code}`}
                />
              </div>
              <code className="cs-pairing-code">{pairing.code}</code>
              <p className="cs-pairing-expire">过期 {formatLocalTime(pairing.expiresAt)}</p>
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
  return (
    <>
      <button type="button" className="cs-back" onClick={onBack} disabled={busy}>
        <ChevronLeft size={16} strokeWidth={1.75} />
        返回
      </button>

      <header className="cs-head cs-head--editor">
        <h1 className="cs-title">{registered ? "服务配置" : "添加连接"}</h1>
        <p className="cs-desc">填写地址并确认可达。</p>
      </header>

      <div className="cs-form">
        <label className="cs-field">
          <span className="cs-field-label">服务地址</span>
          <input
            className="cs-input"
            type="text"
            value={form.serverUrl}
            disabled={busy}
            placeholder="http://127.0.0.1:3128"
            onChange={(event) => {
              onServerUrlChange();
              setForm((current) => ({ ...current, serverUrl: event.target.value }));
            }}
          />
        </label>

        <label className="cs-field">
          <span className="cs-field-label">本机名称</span>
          <input
            className="cs-input"
            type="text"
            value={form.deviceName ?? ""}
            disabled={busy}
            placeholder="Eco Desktop"
            onChange={(event) => setForm((current) => ({ ...current, deviceName: event.target.value }))}
          />
        </label>

        {serverReachable && !registered ? <p className="cs-success">服务可达</p> : null}
        {error ? <p className="cs-error">{error}</p> : null}

        <div className="cs-form-actions">
          <button
            type="button"
            className="cs-btn cs-btn--ghost"
            disabled={busy || !form.serverUrl.trim()}
            onClick={onTestConnection}
          >
            <RefreshCw size={15} strokeWidth={1.75} className={testing ? "cs-spin" : undefined} />
            测试
          </button>
          <button type="button" className="cs-btn" disabled={busy} onClick={onSave}>
            {registered ? "保存" : "继续"}
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
  busy?: boolean;
  onBack: () => void;
  onSubmit: () => void;
}) {
  return (
    <>
      <button type="button" className="cs-back" onClick={onBack} disabled={busy}>
        <ChevronLeft size={16} strokeWidth={1.75} />
        返回
      </button>

      <header className="cs-head cs-head--editor">
        <h1 className="cs-title">{registered ? "重新登录" : "绑定账号"}</h1>
        <p className="cs-desc">
          <code className="cs-inline-code">{serverUrl}</code>
        </p>
      </header>

      <div className="cs-form">
        {!registered ? (
          <div className="cs-tabs" role="tablist" aria-label="账号操作">
            <button
              type="button"
              role="tab"
              aria-selected={authMode === "signup"}
              className={authMode === "signup" ? "cs-tab is-active" : "cs-tab"}
              disabled={busy}
              onClick={() => setAuthMode("signup")}
            >
              注册
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={authMode === "signin"}
              className={authMode === "signin" ? "cs-tab is-active" : "cs-tab"}
              disabled={busy}
              onClick={() => setAuthMode("signin")}
            >
              登录
            </button>
          </div>
        ) : null}

        {authMode === "signup" && !registered ? (
          <label className="cs-field">
            <span className="cs-field-label">昵称</span>
            <input
              className="cs-input"
              type="text"
              value={displayName}
              disabled={busy}
              placeholder="可选"
              onChange={(event) => setDisplayName(event.target.value)}
            />
          </label>
        ) : null}

        <label className="cs-field">
          <span className="cs-field-label">邮箱</span>
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
          <span className="cs-field-label">密码</span>
          <input
            className="cs-input"
            type="password"
            autoComplete={authMode === "signup" ? "new-password" : "current-password"}
            value={password}
            disabled={busy}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>

        {error ? <p className="cs-error">{error}</p> : null}

        <button
          type="button"
          className="cs-btn cs-btn--block"
          disabled={busy || !email.trim() || !password.trim()}
          onClick={onSubmit}
        >
          {authMode === "signup" ? "注册并绑定" : "登录并绑定"}
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
  if (needsReauth) {
    return <span className="cs-service-status is-warn">会话已过期</span>;
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
  const input: CenterServerSettingsInput = {
    enabled: settings.enabled,
    serverUrl: settings.serverUrl,
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
      return "未启用";
    case "disconnected":
      return "未连接";
    case "connecting":
      return "连接中";
    case "connected":
      return "已连接";
    case "error":
      return "连接异常";
  }
}

function formatLocalTime(iso: string): string {
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) {
    return iso;
  }
  return new Date(parsed).toLocaleString();
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

function formatMobileDetail(mobile: CenterServerDevicePresenceView | undefined): string | undefined {
  const parts: string[] = [];
  const ipAddress = mobile?.metadata?.ipAddress?.trim();
  const platform = mobile?.metadata?.platform?.trim();
  if (ipAddress) {
    parts.push(ipAddress);
  }
  if (platform) {
    parts.push(platform);
  }
  return parts.length > 0 ? parts.join(" · ") : undefined;
}
