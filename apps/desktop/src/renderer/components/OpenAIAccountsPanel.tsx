import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Plus, Trash2, Check, Loader2, LogIn, FileUp, Search, X, Pencil, RefreshCw, MoreHorizontal } from "lucide-react";
import { useTranslation } from "react-i18next";

interface OpenAIAccount {
  id: string;
  name: string;
  proxyUrl?: string;
  isLoggedIn: boolean;
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

function formatResetTime(window: { usedPercent: number; limitWindowSeconds: number; resetAfterSeconds: number; resetAt: number }): string {
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
  const [accounts, setAccounts] = useState<OpenAIAccount[]>([]);
  const [activeAccountId, setActiveAccountId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [loggingInId, setLoggingInId] = useState<string | null>(null);
  const [quotas, setQuotas] = useState<Record<string, AccountQuota>>({});
  const [quotaLoading, setQuotaLoading] = useState(false);
  const [quotaLoadingId, setQuotaLoadingId] = useState<string | null>(null);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const menuAnchorRef = useRef<HTMLButtonElement | null>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

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
    try {
      const [list, active] = await Promise.all([
        window.eco.openAIAccountsList(),
        window.eco.openAIAccountsGetActive(),
      ]);
      setAccounts(list);
      setActiveAccountId(active.activeAccountId);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    void refresh();
    const unsub = window.eco.onCodexOauthLoginResult(async () => {
      await refresh();
    });
    return unsub;
  }, [refresh]);

  const refreshQuotas = useCallback(async () => {
    if (accounts.length === 0) return;
    setQuotaLoading(true);
    try {
      const now = Date.now();
      const loggedIn = accounts.filter((a) => a.isLoggedIn);
      const results = await Promise.all(
        loggedIn.map(async (a) => {
          // Skip if cached within 30s
          const cached = quotas[a.id];
          if (cached && now - cached.fetchedAt < 30000) return null;
          try {
            const q = await window.eco.openAIAccountsQueryQuota(a.id);
            return q ? { id: a.id, quota: q } : null;
          } catch {
            return null;
          }
        }),
      );
      const newQuotas: Record<string, AccountQuota> = { ...quotas };
      for (const r of results) {
        if (r) newQuotas[r.id] = r.quota;
      }
      setQuotas(newQuotas);
    } finally {
      setQuotaLoading(false);
    }
  }, [accounts, quotas]);

  // Filtered accounts
  const filteredAccounts = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return accounts;
    return accounts.filter((a) => a.name.toLowerCase().includes(query));
  }, [accounts, searchQuery]);

  const handleCreate = useCallback(async () => {
    const name = modalName.trim();
    if (!name) return;
    setBusy(true);
    try {
      if (modalEditId) {
        // Edit mode: update existing account
        await window.eco.openAIAccountsUpdate(modalEditId, name, modalProxy.trim() || undefined);
        if (modalMode === "manual" && modalAuthJson.trim()) {
          await window.eco.openAIAccountsSetAuthJson(modalEditId, modalAuthJson.trim());
        }
      } else {
        // Create mode
        const account = await window.eco.openAIAccountsCreate(name, modalProxy.trim() || undefined);
        if (modalMode === "manual" && modalAuthJson.trim()) {
          await window.eco.openAIAccountsSetAuthJson(account.id, modalAuthJson.trim());
        } else if (modalMode === "login") {
          await window.eco.openAIAccountsStartLogin(account.id);
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
  }, [modalName, modalProxy, modalMode, modalAuthJson, modalEditId, refresh]);

  const handleDelete = useCallback(
    async (accountId: string) => {
      setBusy(true);
      try {
        await window.eco.openAIAccountsDelete(accountId);
        await refresh();
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  const handleLogin = useCallback(async (accountId: string) => {
    setLoggingInId(accountId);
    try {
      await window.eco.openAIAccountsStartLogin(accountId);
    } finally {
      setLoggingInId(null);
    }
  }, []);

  const handleSetActive = useCallback(
    async (accountId: string) => {
      setBusy(true);
      try {
        await window.eco.openAIAccountsSetActive(accountId);
        await refresh();
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  const handleManualAuth = useCallback(async () => {
    if (!manualAuthId || !manualAuthContent.trim()) return;
    setBusy(true);
    try {
      await window.eco.openAIAccountsSetAuthJson(manualAuthId, manualAuthContent.trim());
      setManualAuthId(null);
      setManualAuthContent("");
      await refresh();
    } finally {
      setBusy(false);
    }
  }, [manualAuthId, manualAuthContent, refresh]);

  return (
    <section className="mcp-list-section">
      <div className="mcp-list-toolbar">
        <span className="mcp-list-toolbar-label">{t("settings.openaiAccounts.title")}</span>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            type="button"
            className="mcp-icon-button"
            onClick={() => void refreshQuotas()}
            disabled={quotaLoading || accounts.length === 0}
            title={t("settings.openaiAccounts.refreshQuota")}
          >
            <RefreshCw size={16} className={quotaLoading ? "spin" : undefined} />
          </button>
          <button type="button" className="mcp-add-button" disabled={busy} onClick={() => { setModalEditId(null); setModalOpen(true); }}>
            <Plus size={16} />
            {t("settings.openaiAccounts.addAccount")}
          </button>
        </div>
      </div>

      {/* Search */}
      {accounts.length > 1 && (
        <div className="mcp-field" style={{ marginBottom: 12 }}>
          <div className="search-input-wrapper">
            <Search size={14} className="search-input-icon" />
            <input
              className="mcp-field-input search-input"
              type="text"
              value={searchQuery}
              placeholder={t("settings.openaiAccounts.searchPlaceholder")}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button type="button" className="search-input-clear" onClick={() => setSearchQuery("")}>
                <X size={12} />
              </button>
            )}
          </div>
        </div>
      )}

      {filteredAccounts.length === 0 ? (
        <p className="mcp-list-empty">
          {searchQuery
            ? t("settings.openaiAccounts.noMatch")
            : t("settings.openaiAccounts.noAccounts")}
        </p>
      ) : (
        <ul className="mcp-server-list">
          {filteredAccounts.map((account) => (
            <li
              key={account.id}
              className={`mcp-server-row mcp-server-row-grid ${activeAccountId === account.id ? "active" : ""}`}
            >
              <span className="mcp-server-name">
                {account.name}
                {activeAccountId === account.id && (
                  <span className="mcp-server-badge">{t("settings.openaiAccounts.active")}</span>
                )}
              </span>
              <span className="mcp-server-meta account-quota-meta">
                {quotaLoadingId === account.id ? (
                  <Loader2 size={14} className="mcp-spin" style={{ color: "var(--text-muted)" }} />
                ) : quotas[account.id] ? (
                  <>
                    <span className="account-quota-plan">{quotas[account.id].planType}</span>
                    {quotas[account.id].rateLimit?.primaryWindow && (
                      <span className={quotas[account.id].rateLimit.limitReached ? "account-quota-limited" : "account-quota-ok"}>
                        {Math.round(quotas[account.id].rateLimit.primaryWindow.usedPercent)}%
                      </span>
                    )}
                    {quotas[account.id].rateLimit?.primaryWindow && quotas[account.id].rateLimit.primaryWindow.resetAfterSeconds > 0 && (
                      <span className="account-quota-reset">
                        {formatResetTime(quotas[account.id].rateLimit.primaryWindow)}
                      </span>
                    )}
                    {quotas[account.id].resetCreditsAvailable > 0 && (
                      <span className="account-quota-credits">
                        {quotas[account.id].resetCreditsAvailable}x
                      </span>
                    )}
                  </>
                ) : (
                  <span className="account-quota-none">
                    {account.isLoggedIn ? "—" : t("settings.openaiAccounts.notLoggedIn")}
                  </span>
                )}
              </span>
              <div className="mcp-server-actions">
                {activeAccountId === account.id ? (
                  <span className="account-active-dot" title={t("settings.openaiAccounts.active")} />
                ) : (
                  <button
                    type="button"
                    className="mcp-icon-button"
                    onClick={() => void handleSetActive(account.id)}
                    disabled={busy || !account.isLoggedIn}
                    title={t("settings.openaiAccounts.activate")}
                  >
                    <Check size={16} />
                  </button>
                )}
                <button
                  type="button"
                  className="mcp-icon-button"
                  ref={(el) => { menuAnchorRef.current = el; }}
                  onClick={() => {
                    if (menuOpenId === account.id) {
                      setMenuOpenId(null);
                    } else {
                      const rect = menuAnchorRef.current?.getBoundingClientRect();
                      if (rect) {
                        setMenuPos({ top: rect.bottom + 4, left: rect.right - 160 });
                      }
                      setMenuOpenId(account.id);
                    }
                  }}
                >
                  <MoreHorizontal size={16} />
                </button>
                {menuOpenId === account.id &&
                  createPortal(
                    <div
                      className="account-action-menu"
                      style={{ position: "fixed", top: menuPos.top, left: menuPos.left }}
                      onMouseLeave={() => setMenuOpenId(null)}
                    >
                    <button
                      type="button"
                      className="account-action-item"
                      onClick={async () => {
                        setMenuOpenId(null);
                        const cached = quotas[account.id];
                        if (cached && Date.now() - cached.fetchedAt < 30000) return;
                        setQuotaLoadingId(account.id);
                        try {
                          const q = await window.eco.openAIAccountsQueryQuota(account.id);
                          if (q) setQuotas((prev) => ({ ...prev, [account.id]: q }));
                        } catch { /* ignore */ }
                        finally { setQuotaLoadingId(null); }
                      }}
                      disabled={!account.isLoggedIn || quotaLoadingId === account.id}
                    >
                      {quotaLoadingId === account.id ? <Loader2 size={14} className="mcp-spin" /> : <RefreshCw size={14} />}
                      {t("settings.openaiAccounts.refreshQuota")}
                    </button>
                    <button
                      type="button"
                      className="account-action-item"
                      onClick={() => {
                        setMenuOpenId(null);
                        void handleLogin(account.id);
                      }}
                      disabled={busy || loggingInId !== null}
                    >
                      <LogIn size={14} />
                      {t("settings.openaiAccounts.login")}
                    </button>
                    <button
                      type="button"
                      className="account-action-item"
                      onClick={async () => {
                        setMenuOpenId(null);
                        setModalEditId(account.id);
                        setModalName(account.name);
                        setModalProxy(account.proxyUrl ?? "");
                        setModalAuthJson("");
                        setModalMode("login");
                        setModalOpen(true);
                        const authContent = await window.eco.openAIAccountsGetAuthJson(account.id);
                        if (authContent) {
                          setModalAuthJson(authContent);
                          setModalMode("manual");
                        }
                      }}
                      disabled={busy}
                    >
                      <Pencil size={14} />
                      {t("common.edit")}
                    </button>
                    <button
                      type="button"
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
                )}
              </div>
            </li>
          ))}
        </ul>
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
              <h2 className="settings-modal-title">{modalEditId ? t("settings.openaiAccounts.editAccount") : t("settings.openaiAccounts.addAccount")}</h2>
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
                <span className="mcp-field-label">{t("settings.openaiAccounts.name")}</span>
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
                <span className="mcp-field-label">{t("settings.openaiAccounts.proxy")}</span>
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
                  className={modalMode === "login" ? "modal-mode-btn active" : "modal-mode-btn"}
                  onClick={() => setModalMode("login")}
                >
                  <LogIn size={14} />
                  {t("settings.openaiAccounts.loginMode")}
                </button>
                <button
                  type="button"
                  className={modalMode === "manual" ? "modal-mode-btn active" : "modal-mode-btn"}
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
              <button type="button" className="settings-modal-cancel" onClick={() => setModalOpen(false)} disabled={busy}>
                {t("common.cancel")}
              </button>
              <div className="settings-modal-footer-actions">
                <button
                  type="button"
                  className="plan-button primary"
                  onClick={() => void handleCreate()}
                  disabled={
                    busy || !modalName.trim() || (modalMode === "manual" && !modalAuthJson.trim())
                  }
                >
                  {busy ? <Loader2 size={14} className="mcp-spin" /> : null}
                  {modalMode === "login"
                    ? (modalEditId ? t("common.save") : t("settings.openaiAccounts.createAndLogin"))
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
