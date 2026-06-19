import { ChevronLeft, Link2, QrCode, RefreshCw, Unplug } from "lucide-react";
import { useEffect, useState } from "react";
import type {
  CenterServerConnectionStatus,
  CenterServerCreatePairingResult,
  CenterServerSettingsInput,
  CenterServerSettingsSnapshot,
  CenterServerSettingsView,
  CenterServerSignInRequest,
  CenterServerSignUpRequest,
} from "../shared/center-server";
import { AppMessage, useAppMessage } from "./AppMessage";

interface CenterServerSettingsPanelProps {
  snapshot: CenterServerSettingsSnapshot;
  busy?: boolean;
  onSave: (input: CenterServerSettingsInput) => Promise<CenterServerSettingsSnapshot>;
  onTestConnection: (serverUrl: string) => Promise<{ ok: boolean; error?: string }>;
  onSignUp: (request: CenterServerSignUpRequest) => Promise<CenterServerSettingsSnapshot>;
  onSignIn: (request: CenterServerSignInRequest) => Promise<CenterServerSettingsSnapshot>;
  onCreatePairing: () => Promise<CenterServerCreatePairingResult>;
  onConnect: () => Promise<CenterServerSettingsSnapshot>;
  onDisconnect: () => Promise<CenterServerSettingsSnapshot>;
}

type PanelView = "server" | "account" | "manage";
type AccountAuthMode = "signup" | "signin";

const FLOW_STEPS: { id: PanelView; label: string }[] = [
  { id: "server", label: "服务" },
  { id: "account", label: "账号" },
  { id: "manage", label: "连接" },
];

export function CenterServerSettingsPanel({
  snapshot,
  busy,
  onSave,
  onTestConnection,
  onSignUp,
  onSignIn,
  onCreatePairing,
  onConnect,
  onDisconnect,
}: CenterServerSettingsPanelProps) {
  const [form, setForm] = useState<CenterServerSettingsInput>(() => viewToInput(snapshot.settings));
  const [view, setView] = useState<PanelView>(() => resolveInitialView(snapshot));
  const [authMode, setAuthMode] = useState<AccountAuthMode>("signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [pairing, setPairing] = useState<CenterServerCreatePairingResult>();
  const [testing, setTesting] = useState(false);
  const [pairingBusy, setPairingBusy] = useState(false);
  const [connectionBusy, setConnectionBusy] = useState(false);
  const [serverReachable, setServerReachable] = useState(false);
  const appMessage = useAppMessage();

  const registered = snapshot.settings.hasDeviceSecret || snapshot.settings.hasRefreshToken;
  const hasUrl = form.serverUrl.trim().length > 0;
  const actionBusy = busy || testing || pairingBusy || connectionBusy;
  const isLive = snapshot.status.state === "connected";
  const isConnecting = snapshot.status.state === "connecting";
  const serverUrl = form.serverUrl || snapshot.settings.serverUrl;

  useEffect(() => {
    setForm(viewToInput(snapshot.settings));
  }, [snapshot.settings]);

  useEffect(() => {
    if (registered) {
      setView("manage");
    }
  }, [registered]);

  async function handleTestConnection() {
    setTesting(true);
    try {
      const result = await onTestConnection(form.serverUrl);
      if (result.ok) {
        setServerReachable(true);
        appMessage.showSuccess("服务可达。");
      } else {
        setServerReachable(false);
        appMessage.showError(result.error ?? "无法访问服务，请检查地址后重试。");
      }
    } catch (caught) {
      setServerReachable(false);
      appMessage.showError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setTesting(false);
    }
  }

  async function handleContinueToAccount() {
    const deviceName = form.deviceName?.trim();
    if (!hasUrl) {
      appMessage.showError("请填写服务地址。");
      return;
    }
    if (!deviceName) {
      appMessage.showError("请填写本机名称。");
      return;
    }
    if (!serverReachable) {
      appMessage.showError("请先测试服务可达性。");
      return;
    }
    try {
      await onSave({
        ...form,
        enabled: false,
        serverUrl: form.serverUrl.trim(),
        deviceName,
      });
      setView("account");
      appMessage.showInfo("请注册或登录账号。");
    } catch (caught) {
      appMessage.showError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  async function handleAccountAuth() {
    const deviceName = form.deviceName?.trim() || snapshot.settings.deviceName;
    if (!email.trim() || !password.trim() || !deviceName) {
      appMessage.showError("请填写邮箱和密码。");
      return;
    }
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
        appMessage.showSuccess("账号已创建，本机已绑定。");
      } else {
        await onSignIn({
          serverUrl: form.serverUrl,
          email: email.trim(),
          password,
          deviceName,
        });
        setPassword("");
        appMessage.showSuccess("登录成功，本机已绑定。");
      }
      setView("manage");
    } catch (caught) {
      appMessage.showError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  async function handleConnect() {
    setConnectionBusy(true);
    try {
      const nextForm = { ...form, enabled: true };
      await onSave(nextForm);
      setForm(nextForm);
      const snapshot = await onConnect();
      if (snapshot.status.state === "connected") {
        appMessage.showSuccess("已连接到服务。");
      } else {
        appMessage.showError(snapshot.status.lastError ?? "连接未完成，请稍后重试。");
      }
    } catch (caught) {
      appMessage.showError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setConnectionBusy(false);
    }
  }

  async function handleDisconnect() {
    setConnectionBusy(true);
    try {
      const nextForm = { ...form, enabled: false };
      await onSave(nextForm);
      setForm(nextForm);
      await onDisconnect();
      appMessage.showInfo("已断开连接。");
    } catch (caught) {
      appMessage.showError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setConnectionBusy(false);
    }
  }

  async function handleAutoStartToggle(enabled: boolean) {
    const nextForm = { ...form, enabled };
    setForm(nextForm);
    try {
      await onSave(nextForm);
      appMessage.showInfo(enabled ? "已开启启动时自动连接。" : "已关闭启动时自动连接。");
    } catch (caught) {
      appMessage.showError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  async function handleCreatePairing() {
    setPairingBusy(true);
    try {
      setPairing(await onCreatePairing());
      appMessage.showSuccess("配对码已生成。");
    } catch (caught) {
      appMessage.showError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setPairingBusy(false);
    }
  }

  const header = view === "server"
    ? { title: "配置服务", desc: "填写远程服务地址，确认可达后继续。" }
    : view === "account"
      ? { title: "注册账号", desc: "创建或登录账号，将本机绑定为桌面设备。" }
      : { title: "连接", desc: "管理与服务器的连接，并生成手机端配对码。" };

  return (
    <>
      {appMessage.state && (
        <AppMessage
          kind={appMessage.state.kind}
          message={appMessage.state.message}
          onDismiss={appMessage.dismiss}
        />
      )}

      <div className="connect-flow">
        <ConnectStepTrail view={view} />

        {view === "account" && (
          <button
            type="button"
            className="settings-nav-back connect-flow-back"
            disabled={actionBusy}
            onClick={() => setView("server")}
          >
            <ChevronLeft size={18} />
            返回修改服务
          </button>
        )}

        <header className="settings-page-header connect-flow-header">
          <h1 className="connect-flow-title">{header.title}</h1>
          <p className="settings-page-desc">{header.desc}</p>
        </header>

        {view === "server" && (
          <section className="settings-section">
            <div className="settings-editor-card">
              <div className="settings-form">
                <label className="settings-form-field">
                  <span className="settings-form-label">服务地址</span>
                  <input
                    className="settings-form-input"
                    type="text"
                    value={form.serverUrl}
                    disabled={actionBusy}
                    placeholder="http://127.0.0.1:3128"
                    onChange={(event) => {
                      setServerReachable(false);
                      setForm((current) => ({ ...current, serverUrl: event.target.value }));
                    }}
                  />
                  <span className="settings-field-hint">本地开发可填 http://127.0.0.1:3128</span>
                </label>

                <label className="settings-form-field">
                  <span className="settings-form-label">本机名称</span>
                  <input
                    className="settings-form-input"
                    type="text"
                    value={form.deviceName ?? ""}
                    disabled={actionBusy}
                    placeholder="Eco Desktop"
                    onChange={(event) => setForm((current) => ({ ...current, deviceName: event.target.value }))}
                  />
                </label>

                {serverReachable && (
                  <p className="settings-form-success">服务可达，可进入下一步。</p>
                )}

                <div className="settings-editor-actions settings-form-actions">
                  <button
                    type="button"
                    className="settings-secondary-button"
                    disabled={actionBusy || !hasUrl}
                    onClick={() => void handleTestConnection()}
                  >
                    <RefreshCw size={16} className={testing ? "model-refresh-spin" : undefined} />
                    测试可达性
                  </button>
                  <button
                    type="button"
                    className="settings-primary-button"
                    disabled={actionBusy || !hasUrl || !serverReachable}
                    onClick={() => void handleContinueToAccount()}
                  >
                    下一步
                  </button>
                </div>
              </div>
            </div>
          </section>
        )}

        {view === "account" && (
          <section className="settings-section">
            <div className="settings-section-head">
              <div>
                <span className="settings-section-label">目标服务</span>
                <p className="settings-section-subtitle">{serverUrl}</p>
              </div>
            </div>

            <div className="settings-editor-card">
              <div className="settings-form">
                <div className="settings-editor-actions settings-form-actions connect-flow-tabs">
                  <button
                    type="button"
                    className={authMode === "signup" ? "settings-primary-button" : "settings-secondary-button"}
                    disabled={actionBusy}
                    onClick={() => setAuthMode("signup")}
                  >
                    注册账号
                  </button>
                  <button
                    type="button"
                    className={authMode === "signin" ? "settings-primary-button" : "settings-secondary-button"}
                    disabled={actionBusy}
                    onClick={() => setAuthMode("signin")}
                  >
                    登录
                  </button>
                </div>

                {authMode === "signup" && (
                  <label className="settings-form-field">
                    <span className="settings-form-label">昵称（可选）</span>
                    <input
                      className="settings-form-input"
                      type="text"
                      value={displayName}
                      disabled={actionBusy}
                      placeholder="显示名称"
                      onChange={(event) => setDisplayName(event.target.value)}
                    />
                  </label>
                )}

                <label className="settings-form-field">
                  <span className="settings-form-label">邮箱</span>
                  <input
                    className="settings-form-input"
                    type="email"
                    autoComplete="username"
                    value={email}
                    disabled={actionBusy}
                    placeholder="you@example.com"
                    onChange={(event) => setEmail(event.target.value)}
                  />
                </label>

                <label className="settings-form-field">
                  <span className="settings-form-label">密码</span>
                  <input
                    className="settings-form-input"
                    type="password"
                    autoComplete={authMode === "signup" ? "new-password" : "current-password"}
                    value={password}
                    disabled={actionBusy}
                    placeholder={authMode === "signup" ? "设置登录密码" : "输入登录密码"}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                </label>

                <div className="settings-editor-actions settings-form-actions">
                  <button
                    type="button"
                    className="settings-primary-button"
                    disabled={actionBusy || !email.trim() || !password.trim()}
                    onClick={() => void handleAccountAuth()}
                  >
                    {authMode === "signup" ? "注册并绑定本机" : "登录并绑定本机"}
                  </button>
                </div>
              </div>
            </div>
          </section>
        )}

        {view === "manage" && (
          <section className="settings-section">
            <div className="settings-section-head">
              <span className="settings-section-label">连接状态</span>
              <ConnectionStatusBadge status={snapshot.status} />
            </div>

            <div className="settings-editor-card">
              <div className="settings-form">
                <ConnectionSummary snapshot={snapshot} />

                {isLive && (
                  <label className="settings-toggle-row">
                    <span>应用启动时自动连接</span>
                    <input
                      type="checkbox"
                      checked={form.enabled}
                      disabled={actionBusy}
                      onChange={(event) => void handleAutoStartToggle(event.target.checked)}
                    />
                  </label>
                )}

                {pairing && (
                  <div className="settings-form-field">
                    <span className="settings-form-label">配对码</span>
                    <code className="connect-flow-pairing-code">{pairing.code}</code>
                    <span className="settings-field-hint">过期时间：{formatLocalTime(pairing.expiresAt)}</span>
                  </div>
                )}

                <div className="settings-editor-actions settings-form-actions">
                  {!isLive ? (
                    <>
                      <button
                        type="button"
                        className="settings-secondary-button"
                        disabled={actionBusy || isConnecting}
                        onClick={() => {
                          setServerReachable(Boolean(snapshot.settings.serverUrl.trim()));
                          setView("server");
                        }}
                      >
                        更改服务配置
                      </button>
                      <button
                        type="button"
                        className="settings-primary-button"
                        disabled={actionBusy || isConnecting}
                        onClick={() => void handleConnect()}
                      >
                        <Link2 size={16} />
                        {isConnecting ? "连接中…" : "连接"}
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="settings-secondary-button"
                        disabled={actionBusy}
                        onClick={() => void handleDisconnect()}
                      >
                        <Unplug size={16} />
                        断开连接
                      </button>
                      <button
                        type="button"
                        className="settings-secondary-button"
                        disabled={actionBusy || pairingBusy}
                        onClick={() => void handleCreatePairing()}
                      >
                        <QrCode size={16} />
                        生成配对码
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          </section>
        )}
      </div>
    </>
  );
}

function ConnectStepTrail({ view }: { view: PanelView }) {
  const activeIndex = view === "server" ? 0 : view === "account" ? 1 : 2;

  return (
    <ol className="connect-flow-steps" aria-label="设置进度">
      {FLOW_STEPS.map((step, index) => (
        <li
          key={step.id}
          className={[
            index === activeIndex ? "is-current" : "",
            index < activeIndex ? "is-done" : "",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          {step.label}
        </li>
      ))}
    </ol>
  );
}

function ConnectionSummary({ snapshot }: { snapshot: CenterServerSettingsSnapshot }) {
  const lines: string[] = [];
  if (snapshot.settings.serverUrl) {
    lines.push(`服务：${snapshot.settings.serverUrl}`);
  }
  if (snapshot.settings.deviceId) {
    lines.push(`设备：${snapshot.settings.deviceName}（${snapshot.settings.deviceId}）`);
  }
  if (snapshot.status.connectedAt) {
    lines.push(`连接时间：${formatLocalTime(snapshot.status.connectedAt)}`);
  }

  if (lines.length === 0) {
    return null;
  }

  return (
    <div className="settings-form-field">
      {lines.map((line) => (
        <span key={line} className="settings-field-hint">
          {line}
        </span>
      ))}
    </div>
  );
}

function resolveInitialView(snapshot: CenterServerSettingsSnapshot): PanelView {
  if (snapshot.settings.hasDeviceSecret || snapshot.settings.hasRefreshToken) {
    return "manage";
  }
  if (snapshot.settings.serverUrl.trim()) {
    return "account";
  }
  return "server";
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

function ConnectionStatusBadge({ status }: { status: CenterServerConnectionStatus }) {
  const connected = status.state === "connected";
  const errored = status.state === "error";

  return (
    <span
      className={[
        "settings-badge",
        connected ? "on" : "",
        errored ? "connect-flow-badge-error" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {connectionStatusLabel(status.state)}
    </span>
  );
}

function connectionStatusLabel(state: CenterServerConnectionStatus["state"]): string {
  switch (state) {
    case "disabled":
      return "未连接";
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
