import { ChevronLeft, Link2, Plus, QrCode, RefreshCw, Settings2, Smartphone, Unlink } from "lucide-react";
import { type Dispatch, type SetStateAction, useCallback, useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
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
import { isLocalhostCenterServerUrl } from "../shared/center-server";

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
        setError(nextSnapshot.status.lastError ?? "连接失败，将自动重试。");
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

  if (view === "edit-server") {
    return (
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
    );
  }

  if (view === "edit-account") {
    return (
      <AccountEditor
        serverUrl={serverUrl}
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
        onBack={() => setView("edit-server")}
        onSubmit={() => void handleAccountAuth()}
      />
    );
  }

  return (
    <>
      <header className="mcp-page-header">
        <h1>连接</h1>
        <p className="mcp-page-desc">
          连接远程 Eco 服务，与手机端同步会话并远程控制本机 Agent。
        </p>
      </header>

      {error && <p className="settings-form-error mcp-list-error">{error}</p>}

      <section className="mcp-list-section">
        <div className="mcp-list-toolbar">
          <span className="mcp-list-toolbar-label">远程服务</span>
          {!registered && (
            <button type="button" className="mcp-add-button" onClick={openSetup} disabled={actionBusy}>
              <Plus size={16} />
              添加连接
            </button>
          )}
        </div>

        {!registered ? (
          <p className="mcp-list-empty">尚未配置远程服务</p>
        ) : (
          <ul className="mcp-server-list">
            <li className="mcp-server-row center-server-row">
              <div className="center-server-row-main">
                <span className="mcp-server-name">{deviceLabel}</span>
                {serverUrl && <span className="center-server-row-url">{serverUrl}</span>}
                <ConnectionStatusLine status={snapshot.status} />
              </div>
              <div className="mcp-server-actions">
                <button
                  type="button"
                  className="mcp-icon-button"
                  onClick={openServerEditor}
                  aria-label="配置远程服务"
                  disabled={actionBusy}
                >
                  <Settings2 size={18} />
                </button>
                <label
                  className="mcp-toggle"
                  title={form.enabled ? "已启用" : "已禁用"}
                >
                  <input
                    type="checkbox"
                    checked={form.enabled}
                    disabled={actionBusy || isConnecting}
                    onChange={(event) => void handleToggle(event.target.checked)}
                  />
                  <span className="mcp-toggle-track" aria-hidden />
                </label>
              </div>
            </li>
          </ul>
        )}
      </section>

      {registered && isLive && (
        <section className="mcp-list-section center-server-bound-mobile-section">
          <div className="mcp-list-toolbar">
            <span className="mcp-list-toolbar-label">已绑定手机</span>
            <button
              type="button"
              className="mcp-back-button center-server-test-button"
              disabled={actionBusy}
              onClick={() => void refreshBindings()}
            >
              <RefreshCw size={16} className={bindingsLoading ? "model-refresh-spin" : undefined} />
              刷新
            </button>
          </div>

          {bindingsError ? <p className="settings-form-error mcp-list-error">{bindingsError}</p> : null}

          {bindingsLoading && activeBindings.length === 0 ? (
            <p className="mcp-list-empty">加载绑定信息…</p>
          ) : activeBindings.length === 0 ? (
            <p className="mcp-list-empty">暂无绑定手机。生成配对码后，手机 Eco App 扫码即可绑定。</p>
          ) : (
            <ul className="mcp-server-list">
              {activeBindings.map((binding) => {
                const mobile = presence.find((device) => device.id === binding.mobileDeviceId);
                const online = mobile?.online ?? false;
                const mobileLabel = mobile?.name ?? shortenDeviceId(binding.mobileDeviceId);
                const revoking = revokingBindingId === binding.id;
                return (
                  <li key={binding.id} className="mcp-server-row center-server-row center-server-bound-mobile-row">
                    <div className="center-server-row-main">
                      <span className="mcp-server-name center-server-bound-mobile-name">
                        <Smartphone size={16} aria-hidden />
                        {mobileLabel}
                      </span>
                      <span className={`center-server-status is-${online ? "connected" : "disconnected"}`}>
                        {online ? "在线 · 可远程操控本机" : "离线 · 需手机连接 Server"}
                      </span>
                      <span className="center-server-bound-mobile-meta">
                        绑定于 {formatLocalTime(binding.createdAt)}
                      </span>
                    </div>
                    <div className="mcp-server-actions">
                      <button
                        type="button"
                        className="mcp-back-button center-server-unbind-button"
                        disabled={actionBusy || revoking}
                        onClick={() => void handleRevokeBinding(binding)}
                      >
                        <Unlink size={16} />
                        {revoking ? "解绑中…" : "解绑"}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      {registered && isLive && (
        <section className="mcp-list-section center-server-pairing-section">
          <div className="mcp-list-toolbar">
            <span className="mcp-list-toolbar-label">手机配对</span>
            <button
              type="button"
              className="mcp-add-button"
              disabled={actionBusy || pairingBusy}
              onClick={() => void handleCreatePairing()}
            >
              <QrCode size={16} />
              生成配对码
            </button>
          </div>

          {!pairing ? (
            <p className="mcp-list-empty">生成配对码后，手机 Eco App 扫码即可绑定</p>
          ) : (
            <div className="center-server-pairing-card">
              {isLocalhostCenterServerUrl(snapshot.settings.serverUrl) ? (
                <p className="center-server-pairing-hint">
                  当前地址为 localhost，手机无法访问。请改为局域网 IP（如{" "}
                  <code>http://192.168.x.x:3128</code>）后重新生成。
                </p>
              ) : null}
              <div className="center-server-pairing-qr">
                <QRCodeSVG
                  value={pairing.qrPayload}
                  size={180}
                  level="M"
                  includeMargin
                  role="img"
                  aria-label={`配对二维码 ${pairing.code}`}
                />
              </div>
              <p className="center-server-pairing-hint">
                手机 Eco App 点「扫一扫连接」即可自动完成配置与绑定
              </p>
              <code className="center-server-pairing-code">{pairing.code}</code>
              <p className="center-server-pairing-meta">
                过期时间：{formatLocalTime(pairing.expiresAt)}
              </p>
            </div>
          )}
        </section>
      )}
    </>
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
  error?: string;
  busy?: boolean;
  testing: boolean;
  onBack: () => void;
  onTestConnection: () => void;
  onSave: () => void;
  onServerUrlChange: () => void;
}) {
  return (
    <>
      <header className="mcp-editor-header">
        <button type="button" className="mcp-back-button" onClick={onBack} disabled={busy}>
          <ChevronLeft size={18} />
          返回
        </button>
      </header>

      <div className="mcp-editor-title-block">
        <h1>{registered ? "更新远程服务" : "添加远程服务"}</h1>
        <p className="mcp-editor-hint">填写服务地址并确认可达后继续。</p>
      </div>

      <div className="mcp-editor-form">
        <label className="mcp-field">
          <span className="mcp-field-label">服务地址</span>
          <input
            className="mcp-field-input"
            type="text"
            value={form.serverUrl}
            disabled={busy}
            placeholder="http://127.0.0.1:3128"
            onChange={(event) => {
              onServerUrlChange();
              setForm((current) => ({ ...current, serverUrl: event.target.value }));
            }}
          />
          <span className="mcp-field-hint">本地开发可填 <code>http://127.0.0.1:3128</code></span>
        </label>

        <label className="mcp-field">
          <span className="mcp-field-label">本机名称</span>
          <input
            className="mcp-field-input"
            type="text"
            value={form.deviceName ?? ""}
            disabled={busy}
            placeholder="Eco Desktop"
            onChange={(event) => setForm((current) => ({ ...current, deviceName: event.target.value }))}
          />
        </label>

        {serverReachable && !registered && (
          <p className="settings-form-success">服务可达，可继续下一步。</p>
        )}

        {error && <p className="settings-form-error">{error}</p>}

        <div className="center-server-editor-actions">
          <button
            type="button"
            className="mcp-back-button center-server-test-button"
            disabled={busy || !form.serverUrl.trim()}
            onClick={onTestConnection}
          >
            <RefreshCw size={16} className={testing ? "model-refresh-spin" : undefined} />
            测试可达性
          </button>
          <button type="button" className="mcp-save-button" disabled={busy} onClick={onSave}>
            {registered ? "保存" : "下一步"}
          </button>
        </div>
      </div>
    </>
  );
}

function AccountEditor({
  serverUrl,
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
  authMode: AccountAuthMode;
  setAuthMode: (mode: AccountAuthMode) => void;
  email: string;
  setEmail: (value: string) => void;
  password: string;
  setPassword: (value: string) => void;
  displayName: string;
  setDisplayName: (value: string) => void;
  error?: string;
  busy?: boolean;
  onBack: () => void;
  onSubmit: () => void;
}) {
  return (
    <>
      <header className="mcp-editor-header">
        <button type="button" className="mcp-back-button" onClick={onBack} disabled={busy}>
          <ChevronLeft size={18} />
          返回
        </button>
      </header>

      <div className="mcp-editor-title-block">
        <h1>绑定账号</h1>
        <p className="mcp-editor-hint">
          目标服务：<code>{serverUrl}</code>
        </p>
      </div>

      <div className="mcp-editor-form">
        <div className="center-server-auth-tabs">
          <button
            type="button"
            className={authMode === "signup" ? "mcp-save-button center-server-auth-tab" : "mcp-back-button center-server-auth-tab"}
            disabled={busy}
            onClick={() => setAuthMode("signup")}
          >
            注册账号
          </button>
          <button
            type="button"
            className={authMode === "signin" ? "mcp-save-button center-server-auth-tab" : "mcp-back-button center-server-auth-tab"}
            disabled={busy}
            onClick={() => setAuthMode("signin")}
          >
            登录
          </button>
        </div>

        {authMode === "signup" && (
          <label className="mcp-field">
            <span className="mcp-field-label">昵称（可选）</span>
            <input
              className="mcp-field-input"
              type="text"
              value={displayName}
              disabled={busy}
              placeholder="显示名称"
              onChange={(event) => setDisplayName(event.target.value)}
            />
          </label>
        )}

        <label className="mcp-field">
          <span className="mcp-field-label">邮箱</span>
          <input
            className="mcp-field-input"
            type="email"
            autoComplete="username"
            value={email}
            disabled={busy}
            placeholder="you@example.com"
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>

        <label className="mcp-field">
          <span className="mcp-field-label">密码</span>
          <input
            className="mcp-field-input"
            type="password"
            autoComplete={authMode === "signup" ? "new-password" : "current-password"}
            value={password}
            disabled={busy}
            placeholder={authMode === "signup" ? "设置登录密码" : "输入登录密码"}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>

        {error && <p className="settings-form-error">{error}</p>}

        <button
          type="button"
          className="mcp-save-button"
          disabled={busy || !email.trim() || !password.trim()}
          onClick={onSubmit}
        >
          <Link2 size={16} />
          {authMode === "signup" ? "注册并绑定本机" : "登录并绑定本机"}
        </button>
      </div>
    </>
  );
}

function ConnectionStatusLine({ status }: { status: CenterServerConnectionStatus }) {
  return (
    <span className={`center-server-status is-${status.state}`}>
      {connectionStatusLabel(status.state)}
      {status.state === "error" && status.lastError ? ` · ${status.lastError}` : ""}
      {status.state === "connected" && status.connectedAt
        ? ` · ${formatLocalTime(status.connectedAt)}`
        : ""}
    </span>
  );
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
      return "未连接";
    case "disconnected":
      return "未连接";
    case "connecting":
      return "连接中…";
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
