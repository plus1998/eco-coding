import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Plus,
  Trash2,
  Check,
  Loader2,
  LogIn,
  FileUp,
  Search,
  X,
  Pencil,
  RefreshCw,
  MoreHorizontal,
  Globe2,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { useTranslation } from "react-i18next";

interface OpenAIAccount {
  id: string;
  name: string;
  proxyUrl?: string;
  isLoggedIn: boolean;
  authState: "missing" | "configured" | "expired";
  lastLogin?: string;
  createdAt: string;
}

interface AccountQuota {
  planType: string;
  email: string;
  rateLimit: {
    allowed: boolean;
    limitReached: boolean;
    primaryWindow: {
      usedPercent: number;
      limitWindowSeconds: number;
      resetAfterSeconds: number;
      resetAt: number;
    } | null;
    secondaryWindow: {
      usedPercent: number;
      limitWindowSeconds: number;
      resetAfterSeconds: number;
      resetAt: number;
    } | null;
  };
  resetCreditsAvailable: number;
  fetchedAt: number;
}

function formatResetTime(window: {
  usedPercent: number;
  limitWindowSeconds: number;
  resetAfterSeconds: number;
  resetAt: number;
}): string {
  const seconds = window.resetAfterSeconds;
  if (seconds <= 0) return "";
  if (seconds < 3600) {
    const min = Math.ceil(seconds / 60);
    return `${min}m`;
  }
  if (seconds < 86400) {
    const h = Math.floor(seconds / 3600);
    const m = Math.ceil((seconds % 3600) / 60);
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  const d = Math.floor(seconds / 86400);
  const h = Math.ceil((seconds % 86400) / 3600);
  return h > 0 ? `${d}d ${h}h` : `${d}d`;
}

export function OpenAIAccountsPanel() {
  const { t } = useTranslation();
  const eco = window.eco;
  const [accounts, setAccounts] = useState<OpenAIAccount[]>([]);
  const [activeAccountId, setActiveAccountId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [loggingInId, setLoggingInId] = useState<string | null>(null);
  const [quotas, setQuotas] = useState<Record<string, AccountQuota>>({});
  const [quotaErrors, setQuotaErrors] = useState<Record<string, true>>({});
  const [quotaLoading, setQuotaLoading] = useState(false);
  const [quotaLoadingId, setQuotaLoadingId] = useState<string | null>(null);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number }>({
    top: 0,
    left: 0,
  });
  const menuRef = useRef<HTMLDivElement>(null);
  const menuTriggerRef = useRef<HTMLButtonElement | null>(null);

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [modalEditId, setModalEditId] = useState<string | null>(null);
  const [modalName, setModalName] = useState("");
  const [modalProxy, setModalProxy] = useState("");
  const [modalAuthJson, setModalAuthJson] = useState("");
  const [modalMode, setModalMode] = useState<"login" | "manual">("login");

  // Manual auth state for existing accounts
  const [manualAuthId, setManualAuthId] = useState<string | null>(null);
  const [manualAuthContent, setManualAuthContent] = useState("");

  const refresh = useCallback(async () => {
    if (!eco) return;
    try {
      const [list, active] = await Promise.all([
        eco.openAIAccountsList(),
        eco.openAIAccountsGetActive(),
      ]);
      setAccounts(list);
      setActiveAccountId(active.activeAccountId);
    } catch {
      // ignore
    }
  }, [eco]);

  useEffect(() => {
    if (!eco) return undefined;
    void refresh();
    const unsub = eco.onCodexOauthLoginResult(async () => {
      await refresh();
    });
    return unsub;
  }, [eco, refresh]);

  useEffect(() => {
    if (!menuOpenId) return;
    const close = () => setMenuOpenId(null);
    const onPointerDown = (event: PointerEvent) => {
      if (
        !menuRef.current?.contains(event.target as Node) &&
        !menuTriggerRef.current?.contains(event.target as Node)
      )
        close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        close();
        menuTriggerRef.current?.focus();
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const items = Array.from(
          menuRef.current?.querySelectorAll<HTMLButtonElement>(
            "button:not(:disabled)",
          ) ?? [],
        );
        const index = items.indexOf(
          document.activeElement as HTMLButtonElement,
        );
        items[
          (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) %
            items.length
        ]?.focus();
      }
      if (event.key === "Tab") close();
    };
    menuRef.current
      ?.querySelector<HTMLButtonElement>("button:not(:disabled)")
      ?.focus();
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", close);
    document.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", close);
      document.removeEventListener("scroll", close, true);
    };
  }, [menuOpenId]);

  const refreshQuotas = useCallback(async () => {
    if (!eco || accounts.length === 0) return;
    setQuotaLoading(true);
    try {
      const now = Date.now();
      const loggedIn = accounts.filter((a) => a.isLoggedIn);
      const results = await Promise.all(
        loggedIn.map(
          async (
            a,
          ): Promise<{
            id: string;
            quota?: AccountQuota;
            error?: true;
          } | null> => {
            // Skip if cached within 30s
            const cached = quotas[a.id];
            if (cached && now - cached.fetchedAt < 30000) return null;
            try {
              const quota = await eco.openAIAccountsQueryQuota(a.id);
              return quota ? { id: a.id, quota } : { id: a.id, error: true };
            } catch {
              return { id: a.id, error: true };
            }
          },
        ),
      );
      const newQuotas: Record<string, AccountQuota> = { ...quotas };
      const newErrors: Record<string, true> = { ...quotaErrors };
      for (const r of results) {
        if (!r) continue;
        if (r.quota) {
          newQuotas[r.id] = r.quota;
          delete newErrors[r.id];
        } else if (r.error) {
          delete newQuotas[r.id];
          newErrors[r.id] = true;
        }
      }
      setQuotas(newQuotas);
      setQuotaErrors(newErrors);
    } finally {
      setQuotaLoading(false);
    }
  }, [accounts, eco, quotaErrors, quotas]);

  // Filtered accounts
  const filteredAccounts = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return accounts;
    return accounts.filter((a) => a.name.toLowerCase().includes(query));
  }, [accounts, searchQuery]);

  const handleCreate = useCallback(async () => {
    const name = modalName.trim();
    if (!eco || !name) return;
    setBusy(true);
    try {
      if (modalEditId) {
        // Edit mode: update existing account
        await eco.openAIAccountsUpdate(
          modalEditId,
          name,
          modalProxy.trim() || undefined,
        );
        if (modalMode === "manual" && modalAuthJson.trim()) {
          await eco.openAIAccountsSetAuthJson(
            modalEditId,
            modalAuthJson.trim(),
          );
        }
      } else {
        // Create mode
        const account = await eco.openAIAccountsCreate(
          name,
          modalProxy.trim() || undefined,
        );
        if (modalMode === "manual" && modalAuthJson.trim()) {
          await eco.openAIAccountsSetAuthJson(account.id, modalAuthJson.trim());
        } else if (modalMode === "login") {
          await eco.openAIAccountsStartLogin(account.id);
        }
      }
      setModalOpen(false);
      setModalEditId(null);
      setModalName("");
      setModalProxy("");
      setModalAuthJson("");
      setModalMode("login");
      await refresh();
    } finally {
      setBusy(false);
    }
  }, [
    eco,
    modalName,
    modalProxy,
    modalMode,
    modalAuthJson,
    modalEditId,
    refresh,
  ]);

  const handleDelete = useCallback(
    async (accountId: string) => {
      if (!eco) return;
      setBusy(true);
      try {
        await eco.openAIAccountsDelete(accountId);
        await refresh();
      } finally {
        setBusy(false);
      }
    },
    [eco, refresh],
  );

  const handleLogin = useCallback(
    async (accountId: string) => {
      if (!eco) return;
      setLoggingInId(accountId);
      try {
        await eco.openAIAccountsStartLogin(accountId);
      } finally {
        setLoggingInId(null);
      }
    },
    [eco],
  );

  const handleSetActive = useCallback(
    async (accountId: string) => {
      if (!eco) return;
      setBusy(true);
      try {
        await eco.openAIAccountsSetActive(accountId);
        await refresh();
      } finally {
        setBusy(false);
      }
    },
    [eco, refresh],
  );

  const handleManualAuth = useCallback(async () => {
    if (!eco || !manualAuthId || !manualAuthContent.trim()) return;
    setBusy(true);
    try {
      await eco.openAIAccountsSetAuthJson(
        manualAuthId,
        manualAuthContent.trim(),
      );
      setManualAuthId(null);
      setManualAuthContent("");
      await refresh();
    } finally {
      setBusy(false);
    }
  }, [eco, manualAuthId, manualAuthContent, refresh]);

  const loggedInCount = accounts.filter((account) => account.isLoggedIn).length;
  const activeAccount = accounts.find(
    (account) => account.id === activeAccountId,
  );

  return (
    <section className="codex-accounts-panel providers-list-section">
      <div className="codex-accounts-hero">
        <div className="codex-accounts-heading">
          <h2>Codex 账号</h2>
          <p>
            <ShieldCheck size={14} />
            Codex 专用 OAuth 登录，账号仅用于 Codex Agent。
          </p>
        </div>
        <button
          type="button"
          className="settings-primary-button"
          disabled={busy}
          onClick={() => {
            setModalEditId(null);
            setModalName(
              `Codex 账号 ${accounts.length + 1}`,
            );
            setModalProxy("");
            setModalAuthJson("");
            setModalMode("login");
            setModalOpen(true);
          }}
        >
          <Plus size={15} />
          {t("settings.openaiAccounts.addAccount")}
        </button>
      </div>

      <div className="codex-accounts-toolbar">
        <span>
          {accounts.length} 个账号
          <span className="codex-toolbar-divider">·</span>
          {loggedInCount} 个已登录
        </span>
        <div className="codex-toolbar-links">
          {activeAccount ? (
            <span className="codex-active-summary">
              <i />
              当前使用：{activeAccount.name}
            </span>
          ) : (
            <span>尚未选择当前账号</span>
          )}
          <button
            type="button"
            className="chatgpt-inline-link"
            onClick={() => void refreshQuotas()}
            disabled={quotaLoading || accounts.length === 0}
          >
            <RefreshCw
              size={13}
              className={quotaLoading ? "mcp-spin" : undefined}
            />
            {quotaLoading
              ? "刷新中…"
              : t("settings.openaiAccounts.refreshQuota")}
          </button>
        </div>
      </div>

      {accounts.length > 1 ? (
        <div className="codex-accounts-search">
          <Search size={14} className="search-input-icon" />
          <input
            className="mcp-field-input search-input"
            type="text"
            value={searchQuery}
            placeholder={t("settings.openaiAccounts.searchPlaceholder")}
            onChange={(event) => setSearchQuery(event.target.value)}
          />
          {searchQuery ? (
            <button
              type="button"
              className="search-input-clear"
              aria-label="清除搜索"
              onClick={() => setSearchQuery("")}
            >
              <X size={12} />
            </button>
          ) : null}
        </div>
      ) : null}

      {filteredAccounts.length === 0 ? (
        <div className="codex-empty-state">
          {searchQuery ? (
            <>
              <Search size={24} />
              <strong>{t("settings.openaiAccounts.noMatch")}</strong>
            </>
          ) : (
            <>
              <UserRound size={24} />
              <strong>{t("settings.openaiAccounts.noAccounts")}</strong>
              <p>添加并登录后，Codex Agent 才能使用该账号。</p>
              <button
                type="button"
                className="settings-primary-button"
                disabled={busy}
                onClick={() => {
                  setModalEditId(null);
                  setModalName("Codex 账号 1");
                  setModalProxy("");
                  setModalAuthJson("");
                  setModalMode("login");
                  setModalOpen(true);
                }}
              >
                <Plus size={15} />
                {t("settings.openaiAccounts.addAccount")}
              </button>
            </>
          )}
        </div>
      ) : (
        <div className="codex-account-list">
          {filteredAccounts.map((account) => {
            const accountQuota = quotas[account.id];
            const primaryWindow = accountQuota?.rateLimit.primaryWindow;
            const isActive = activeAccountId === account.id;
            const status = !account.isLoggedIn
              ? account.authState === "expired"
                ? "登录已过期"
                : "需要登录"
              : isActive
                ? "当前使用"
                : "已登录";
            const statusTone = !account.isLoggedIn
              ? "danger"
              : isActive
                ? "ready"
                : "muted";
            const email = accountQuota?.email;
            return (
              <article
                key={account.id}
                className={`codex-account-card ${isActive ? "is-active" : ""}`}
              >
                <div className="codex-account-card-main">
                  <div className="codex-account-avatar">
                    <img src="./provider-icons/openai.svg" alt="Codex" />
                  </div>
                  <div className="codex-account-identity">
                    <strong title={account.name}>{account.name}</strong>
                    <span title={email}>
                      {email ||
                        (account.isLoggedIn
                          ? "Codex OAuth 已登录"
                          : "尚未登录")}
                    </span>
                  </div>
                  <span className={`codex-status-badge is-${statusTone}`}>
                    <i />
                    {status}
                  </span>
                  <div className="codex-account-actions">
                    {isActive ? (
                      <span className="codex-current-label">
                        <Check size={14} />
                        当前账号
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="codex-action-primary"
                        disabled={busy || !account.isLoggedIn}
                        onClick={() => void handleSetActive(account.id)}
                      >
                        <Check size={14} />
                        设为当前
                      </button>
                    )}
                    {!account.isLoggedIn ? (
                      <button
                        type="button"
                        className="codex-action-secondary"
                        disabled={busy || loggingInId !== null}
                        onClick={() => void handleLogin(account.id)}
                      >
                        <LogIn size={14} />
                        登录
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="mcp-icon-button"
                      aria-label={`${account.name} 更多操作`}
                      aria-haspopup="menu"
                      aria-expanded={menuOpenId === account.id}
                      disabled={busy}
                      onClick={(event) => {
                        if (menuOpenId === account.id) {
                          setMenuOpenId(null);
                          return;
                        }
                        menuTriggerRef.current = event.currentTarget;
                        const rect =
                          event.currentTarget.getBoundingClientRect();
                        setMenuPos({
                          top: Math.max(
                            8,
                            Math.min(rect.bottom + 4, window.innerHeight - 220),
                          ),
                          left: Math.max(
                            8,
                            Math.min(rect.right - 180, window.innerWidth - 188),
                          ),
                        });
                        setMenuOpenId(account.id);
                      }}
                    >
                      <MoreHorizontal size={16} />
                    </button>
                  </div>
                </div>
                <div className="codex-account-meta">
                  <button
                    type="button"
                    className="codex-proxy-link"
                    disabled={busy}
                    onClick={() => {
                      setModalEditId(account.id);
                      setModalName(account.name);
                      setModalProxy(account.proxyUrl ?? "");
                      setModalAuthJson("");
                      setModalMode("login");
                      setModalOpen(true);
                    }}
                  >
                    <Globe2 size={13} />
                    {account.proxyUrl ? "独立代理" : "全局代理"}
                    <span>配置</span>
                  </button>
                  <span>
                    {account.lastLogin
                      ? `最近登录 ${new Date(account.lastLogin).toLocaleString(undefined, { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}`
                      : "尚未登录"}
                  </span>
                  <span className="codex-quota-summary">
                    {quotaLoadingId === account.id ? (
                      <Loader2 size={13} className="mcp-spin" />
                    ) : accountQuota ? (
                      <>
                        <b>{accountQuota.planType}</b>
                        {primaryWindow ? (
                          <em
                            className={
                              accountQuota.rateLimit.limitReached
                                ? "is-limited"
                                : "is-ok"
                            }
                          >
                            {Math.round(primaryWindow.usedPercent)}% 已使用
                          </em>
                        ) : null}
                        {primaryWindow &&
                        primaryWindow.resetAfterSeconds > 0 ? (
                          <span>{formatResetTime(primaryWindow)} 后重置</span>
                        ) : null}
                        {accountQuota.resetCreditsAvailable > 0 ? (
                          <span>
                            {accountQuota.resetCreditsAvailable} 次重置
                          </span>
                        ) : null}
                      </>
                    ) : (
                      <span
                        className={
                          quotaErrors[account.id] ? "is-error" : undefined
                        }
                      >
                        {quotaErrors[account.id]
                          ? t("settings.openaiAccounts.quotaFailed")
                          : account.isLoggedIn
                            ? "额度未获取"
                            : t("settings.openaiAccounts.notLoggedIn")}
                      </span>
                    )}
                  </span>
                </div>
                {menuOpenId === account.id
                  ? createPortal(
                      <div
                        ref={menuRef}
                        className="account-action-menu codex-account-action-menu"
                        role="menu"
                        aria-label="账号操作"
                        style={{
                          position: "fixed",
                          top: menuPos.top,
                          left: menuPos.left,
                        }}
                      >
                        <button
                          type="button"
                          role="menuitem"
                          className="account-action-item"
                          onClick={() => {
                            setMenuOpenId(null);
                            void handleLogin(account.id);
                          }}
                          disabled={busy || loggingInId !== null}
                        >
                          <LogIn size={14} />
                          {account.isLoggedIn
                            ? "重新登录"
                            : t("settings.openaiAccounts.login")}
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          className="account-action-item"
                          onClick={() => {
                            setMenuOpenId(null);
                            setModalEditId(account.id);
                            setModalName(account.name);
                            setModalProxy(account.proxyUrl ?? "");
                            setModalAuthJson("");
                            setModalMode("login");
                            setModalOpen(true);
                          }}
                          disabled={busy}
                        >
                          <Pencil size={14} />
                          {t("common.edit")}
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          className="account-action-item"
                          onClick={async () => {
                            setMenuOpenId(null);
                            if (!eco) return;
                            setQuotaLoadingId(account.id);
                            try {
                              const quota = await eco.openAIAccountsQueryQuota(
                                account.id,
                              );
                              if (quota) {
                                setQuotas((prev) => ({
                                  ...prev,
                                  [account.id]: quota,
                                }));
                                setQuotaErrors((prev) => {
                                  const next = { ...prev };
                                  delete next[account.id];
                                  return next;
                                });
                              }
                            } catch {
                              setQuotaErrors((prev) => ({
                                ...prev,
                                [account.id]: true,
                              }));
                            } finally {
                              setQuotaLoadingId(null);
                            }
                          }}
                          disabled={
                            !account.isLoggedIn || quotaLoadingId === account.id
                          }
                        >
                          <RefreshCw size={14} />
                          {t("settings.openaiAccounts.refreshQuota")}
                        </button>
                        {!isActive && account.isLoggedIn ? (
                          <button
                            type="button"
                            role="menuitem"
                            className="account-action-item"
                            onClick={() => {
                              setMenuOpenId(null);
                              void handleSetActive(account.id);
                            }}
                            disabled={busy}
                          >
                            <Check size={14} />
                            设为当前
                          </button>
                        ) : null}
                        <button
                          type="button"
                          role="menuitem"
                          className="account-action-item danger"
                          onClick={() => {
                            setMenuOpenId(null);
                            void handleDelete(account.id);
                          }}
                          disabled={busy}
                        >
                          <Trash2 size={14} />
                          {t("common.delete")}
                        </button>
                      </div>,
                      document.body,
                    )
                  : null}
              </article>
            );
          })}
        </div>
      )}

      {/* Manual auth inline editor */}
      {manualAuthId && (
        <div className="manual-auth-panel">
          <div className="manual-auth-header">
            <span>{t("settings.openaiAccounts.manualAuth")}</span>
            <button type="button" onClick={() => setManualAuthId(null)}>
              <X size={14} />
            </button>
          </div>
          <textarea
            className="mcp-field-input mcp-field-textarea"
            value={manualAuthContent}
            placeholder='{"auth_mode":"chatgpt","tokens":{"access_token":"..."}}'
            onChange={(e) => setManualAuthContent(e.target.value)}
            disabled={busy}
            rows={4}
          />
          <div className="manual-auth-actions">
            <button
              type="button"
              className="mcp-save-button"
              onClick={() => void handleManualAuth()}
              disabled={busy || !manualAuthContent.trim()}
            >
              {t("common.save")}
            </button>
          </div>
        </div>
      )}

      {/* Add Account Modal */}
      {modalOpen && (
        <div className="settings-modal-backdrop">
          <button
            type="button"
            className="settings-modal-backdrop-close"
            onClick={() => setModalOpen(false)}
            aria-label={t("common.close")}
            disabled={busy}
          />
          <div
            className="settings-modal settings-modal-provider-editor"
            role="dialog"
            aria-modal="true"
          >
            <header className="settings-modal-header">
              <h2 className="settings-modal-title">
                {modalEditId
                  ? t("settings.openaiAccounts.editAccount")
                  : t("settings.openaiAccounts.addAccount")}
              </h2>
              <div className="settings-modal-header-actions">
                <button
                  type="button"
                  className="mcp-icon-button"
                  onClick={() => setModalOpen(false)}
                  aria-label={t("common.close")}
                >
                  <X size={18} />
                </button>
              </div>
            </header>

            <div className="settings-modal-body openai-account-modal-body">
              <label className="mcp-field">
                <span className="mcp-field-label">
                  {t("settings.openaiAccounts.name")}
                </span>
                <input
                  className="mcp-field-input"
                  type="text"
                  value={modalName}
                  placeholder={t("settings.openaiAccounts.namePlaceholder")}
                  onChange={(e) => setModalName(e.target.value)}
                  autoFocus
                />
              </label>

              {/* Proxy - always visible */}
              <label className="mcp-field modal-proxy-field">
                <span className="mcp-field-label">
                  {t("settings.openaiAccounts.proxy")}
                </span>
                <input
                  className="mcp-field-input"
                  type="text"
                  value={modalProxy}
                  placeholder="http://127.0.0.1:7890"
                  onChange={(e) => setModalProxy(e.target.value)}
                />
              </label>

              {/* Mode toggle */}
              <div className="modal-mode-toggle">
                <button
                  type="button"
                  className={
                    modalMode === "login"
                      ? "modal-mode-btn active"
                      : "modal-mode-btn"
                  }
                  onClick={() => setModalMode("login")}
                >
                  <LogIn size={14} />
                  {t("settings.openaiAccounts.loginMode")}
                </button>
                <button
                  type="button"
                  className={
                    modalMode === "manual"
                      ? "modal-mode-btn active"
                      : "modal-mode-btn"
                  }
                  onClick={() => setModalMode("manual")}
                >
                  <FileUp size={14} />
                  {t("settings.openaiAccounts.manualMode")}
                </button>
              </div>

              {modalMode === "manual" && (
                <label className="mcp-field">
                  <span className="mcp-field-label">auth.json</span>
                  <textarea
                    className="mcp-field-input mcp-field-textarea"
                    value={modalAuthJson}
                    placeholder='{"auth_mode":"chatgpt","tokens":{"access_token":"..."}}'
                    onChange={(e) => setModalAuthJson(e.target.value)}
                    rows={5}
                  />
                </label>
              )}
            </div>

            <footer className="settings-modal-footer settings-modal-footer-split">
              <button
                type="button"
                className="settings-modal-cancel"
                onClick={() => setModalOpen(false)}
                disabled={busy}
              >
                {t("common.cancel")}
              </button>
              <div className="settings-modal-footer-actions">
                <button
                  type="button"
                  className="plan-button primary"
                  onClick={() => void handleCreate()}
                  disabled={
                    busy ||
                    !modalName.trim() ||
                    (modalMode === "manual" && !modalAuthJson.trim())
                  }
                >
                  {busy ? <Loader2 size={14} className="mcp-spin" /> : null}
                  {modalMode === "login"
                    ? modalEditId
                      ? t("common.save")
                      : t("settings.openaiAccounts.createAndLogin")
                    : t("settings.openaiAccounts.createWithAuth")}
                </button>
              </div>
            </footer>
          </div>
        </div>
      )}
    </section>
  );
}
