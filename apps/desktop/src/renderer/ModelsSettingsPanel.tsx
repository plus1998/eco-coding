import { Plus, RefreshCw, Settings2, X } from "lucide-react";
import { type Dispatch, type SetStateAction, useCallback, useEffect, useMemo, useState } from "react";
import type { UpstreamModelOption } from "../shared/models";
import {
  AGENT_ROLES,
  type AgentRole,
  type ModelSettingsSnapshot,
  type ProviderConfigInput,
  type ProviderConfigView,
  type RoleRouteConfig,
} from "../shared/ipc";
import { ModelSelectField } from "./ModelSelectField";

interface ModelsSettingsPanelProps {
  settings: ModelSettingsSnapshot;
  busy?: boolean | undefined;
  onSettingsChange: (settings: ModelSettingsSnapshot) => void;
  onSavingChange?: ((saving: boolean) => void) | undefined;
}

interface ModelsCacheEntry {
  models: UpstreamModelOption[];
  error?: string | undefined;
}

const ROLE_LABELS: Record<AgentRole, string> = {
  planner: "规划",
  architect: "架构",
  coder: "编码",
  reviewer: "审查",
  tester: "测试",
};

export function ModelsSettingsPanel({
  settings,
  busy,
  onSettingsChange,
  onSavingChange,
}: ModelsSettingsPanelProps) {
  const [providerModalOpen, setProviderModalOpen] = useState(false);
  const [providerForm, setProviderForm] = useState<ProviderConfigInput>(() => providerToForm());
  const [modelsCache, setModelsCache] = useState<Record<string, ModelsCacheEntry>>({});
  const [loadingProviderId, setLoadingProviderId] = useState<string | null>(null);
  const [panelError, setPanelError] = useState<string>();
  const [modalError, setModalError] = useState<string>();

  const modalProviderId = providerForm.id ?? "__draft__";
  const modalCache = modelsCache[modalProviderId];

  const refreshSettings = useCallback(async () => {
    if (!window.eco) {
      return;
    }
    const snapshot = await window.eco.getModelSettings();
    onSettingsChange(snapshot);
  }, [onSettingsChange]);

  const fetchModels = useCallback(
    async (target: ProviderConfigInput, options?: { silent?: boolean }) => {
      if (!window.eco) {
        return;
      }
      const cacheKey = target.id ?? "__draft__";
      setLoadingProviderId(cacheKey);
      if (!options?.silent) {
        setModalError(undefined);
      }

      try {
        const request = {
          baseUrl: target.baseUrl,
          ...(target.id && { providerId: target.id }),
          ...(target.apiKey && { apiKey: target.apiKey }),
        };
        const result = await window.eco.listProviderModels(request);
        if (!result.ok) {
          setModelsCache((current) => ({
            ...current,
            [cacheKey]: { models: current[cacheKey]?.models ?? [], error: result.error },
          }));
          if (!options?.silent) {
            setModalError(result.error);
          }
          return;
        }
        setModelsCache((current) => ({
          ...current,
          [cacheKey]: { models: result.models },
        }));
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : String(caught);
        setModelsCache((current) => ({
          ...current,
          [cacheKey]: { models: current[cacheKey]?.models ?? [], error: message },
        }));
        if (!options?.silent) {
          setModalError(message);
        }
      } finally {
        setLoadingProviderId(null);
      }
    },
    [],
  );

  useEffect(() => {
    if (!providerModalOpen || !providerForm.id) {
      return;
    }
    const provider = settings.providers.find((entry) => entry.id === providerForm.id);
    if (!provider?.hasApiKey) {
      return;
    }
    if (modelsCache[providerForm.id]?.models.length) {
      return;
    }
    void fetchModels(providerForm, { silent: true });
  }, [providerModalOpen, providerForm, settings.providers, modelsCache, fetchModels]);

  const modelsForProvider = useCallback(
    (providerId: string): UpstreamModelOption[] => modelsCache[providerId]?.models ?? [],
    [modelsCache],
  );

  const modelsErrorForProvider = useCallback(
    (providerId: string): string | undefined => modelsCache[providerId]?.error,
    [modelsCache],
  );

  const loadingForProvider = useCallback(
    (providerId: string) => loadingProviderId === providerId,
    [loadingProviderId],
  );

  function openCreateProvider() {
    setPanelError(undefined);
    setModalError(undefined);
    setProviderForm(providerToForm());
    setProviderModalOpen(true);
  }

  function openEditProvider(provider: ProviderConfigView) {
    setPanelError(undefined);
    setModalError(undefined);
    setProviderForm(providerToForm(provider));
    setProviderModalOpen(true);
  }

  function closeProviderModal() {
    setProviderModalOpen(false);
    setModalError(undefined);
    setProviderForm(providerToForm());
  }

  async function saveProvider() {
    if (!window.eco) {
      return;
    }
    setModalError(undefined);
    onSavingChange?.(true);
    try {
      const provider = await window.eco.saveProvider(providerForm);
      await refreshSettings();
      setModelsCache((current) => {
        const draft = current.__draft__;
        if (!draft) {
          return current;
        }
        const next = { ...current };
        next[provider.id] = draft;
        delete next.__draft__;
        return next;
      });
      closeProviderModal();
    } catch (caught) {
      setModalError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      onSavingChange?.(false);
    }
  }

  async function toggleProvider(provider: ProviderConfigView) {
    if (!window.eco) {
      return;
    }
    setPanelError(undefined);
    onSavingChange?.(true);
    try {
      await window.eco.saveProvider({ ...providerToForm(provider), enabled: !provider.enabled });
      await refreshSettings();
    } catch (caught) {
      setPanelError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      onSavingChange?.(false);
    }
  }

  async function saveRoutes() {
    if (!window.eco) {
      return;
    }
    setPanelError(undefined);
    onSavingChange?.(true);
    try {
      const routes = await window.eco.saveRoleRoutes(settings.routes);
      onSettingsChange({ ...settings, routes });
    } catch (caught) {
      setPanelError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      onSavingChange?.(false);
    }
  }

  function updateRoute(role: AgentRole, patch: Partial<RoleRouteConfig>) {
    const existingRoute = settings.routes.find((route) => route.role === role);
    const nextRoute: RoleRouteConfig = {
      role,
      providerId: patch.providerId ?? existingRoute?.providerId ?? settings.providers[0]?.id ?? "",
      modelId: patch.modelId ?? existingRoute?.modelId ?? settings.providers[0]?.defaultModel ?? "",
    };
    onSettingsChange({
      ...settings,
      routes: [...settings.routes.filter((route) => route.role !== role), nextRoute],
    });
  }

  const providerOptions = useMemo(() => settings.providers, [settings.providers]);

  return (
    <>
      <header className="mcp-page-header">
        <h1>模型与路由</h1>
        <p className="mcp-page-desc">
          从上游 <code>GET /v1/models</code> 拉取可选模型，也支持手动填写 model id。配置保存在本地 SQLite。
        </p>
      </header>

      {panelError && <p className="settings-form-error mcp-list-error">{panelError}</p>}

      <section className="mcp-list-section">
        <div className="mcp-list-toolbar">
          <span className="mcp-list-toolbar-label">Provider</span>
          <button type="button" className="mcp-add-button" disabled={busy} onClick={openCreateProvider}>
            <Plus size={16} />
            添加 Provider
          </button>
        </div>

        {providerOptions.length === 0 ? (
          <p className="mcp-list-empty">尚未添加 Provider</p>
        ) : (
          <ul className="mcp-server-list">
            {providerOptions.map((provider) => (
              <li key={provider.id} className="mcp-server-row models-provider-row">
                <div className="models-provider-row-main">
                  <span className="mcp-server-name">{provider.name}</span>
                  <small>
                    {provider.defaultModel}
                    {provider.hasApiKey ? " · 已配置 Key" : " · 无 Key"}
                  </small>
                </div>
                <div className="mcp-server-actions">
                  <span className={provider.enabled ? "models-provider-badge on" : "models-provider-badge"}>
                    {provider.enabled ? "已启用" : "已禁用"}
                  </span>
                  <button
                    type="button"
                    className="mcp-icon-button"
                    onClick={() => openEditProvider(provider)}
                    aria-label={`配置 ${provider.name}`}
                    disabled={busy}
                  >
                    <Settings2 size={18} />
                  </button>
                  <label className="mcp-toggle" title={provider.enabled ? "已启用" : "已禁用"}>
                    <input
                      type="checkbox"
                      checked={provider.enabled}
                      disabled={busy}
                      onChange={() => void toggleProvider(provider)}
                    />
                    <span className="mcp-toggle-track" aria-hidden />
                  </label>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mcp-list-section models-routes-section">
        <div className="mcp-list-toolbar">
          <span className="mcp-list-toolbar-label">角色路由</span>
          <button type="button" className="mcp-add-button" disabled={busy} onClick={() => void saveRoutes()}>
            保存路由
          </button>
        </div>

        <ul className="models-route-list">
          {AGENT_ROLES.map((role) => {
            const route = settings.routes.find((candidate) => candidate.role === role);
            const providerId = route?.providerId ?? settings.providers[0]?.id ?? "";
            const routeModels = modelsForProvider(providerId);
            const routeLoading = loadingForProvider(providerId);
            const routeError = modelsErrorForProvider(providerId);

            return (
              <li key={role} className="models-route-card">
                <div className="models-route-card-head">
                  <span className="models-route-role">{ROLE_LABELS[role]}</span>
                  <span className="models-route-role-id">{role}</span>
                </div>
                <label className="mcp-field">
                  <span className="mcp-field-label">Provider</span>
                  <select
                    className="mcp-field-input"
                    value={providerId}
                    disabled={busy}
                    onChange={(event) => {
                      const nextProviderId = event.target.value;
                      const provider = settings.providers.find((entry) => entry.id === nextProviderId);
                      updateRoute(role, {
                        providerId: nextProviderId,
                        modelId: route?.modelId || provider?.defaultModel || "",
                      });
                      if (provider?.hasApiKey && !modelsCache[nextProviderId]?.models.length) {
                        void fetchModels(providerToForm(provider), { silent: true });
                      }
                    }}
                  >
                    {settings.providers.map((provider) => (
                      <option key={provider.id} value={provider.id}>
                        {provider.name}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="mcp-field">
                  <div className="model-field-head">
                    <span className="mcp-field-label">模型</span>
                    {providerId && (
                      <button
                        type="button"
                        className="model-inline-refresh"
                        disabled={busy || routeLoading}
                        onClick={() => {
                          const provider = settings.providers.find((entry) => entry.id === providerId);
                          if (provider) {
                            void fetchModels(providerToForm(provider));
                          }
                        }}
                      >
                        <RefreshCw size={14} className={routeLoading ? "model-refresh-spin" : undefined} />
                        刷新
                      </button>
                    )}
                  </div>
                  <ModelSelectField
                    value={route?.modelId ?? ""}
                    models={routeModels}
                    loading={routeLoading}
                    error={routeError}
                    disabled={busy || !providerId}
                    onRefresh={() => {
                      const provider = settings.providers.find((entry) => entry.id === providerId);
                      if (provider) {
                        void fetchModels(providerToForm(provider));
                      }
                    }}
                    onChange={(modelId) => updateRoute(role, { modelId })}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      {providerModalOpen && (
        <ProviderEditorModal
          form={providerForm}
          setForm={setProviderForm}
          models={modalCache?.models ?? []}
          modelsLoading={loadingForProvider(modalProviderId)}
          modelsError={modalCache?.error}
          error={modalError}
          busy={busy}
          onClose={closeProviderModal}
          onSave={() => void saveProvider()}
          onRefreshModels={() => void fetchModels(providerForm)}
        />
      )}
    </>
  );
}

function ProviderEditorModal({
  form,
  setForm,
  models,
  modelsLoading,
  modelsError,
  error,
  busy,
  onClose,
  onSave,
  onRefreshModels,
}: {
  form: ProviderConfigInput;
  setForm: Dispatch<SetStateAction<ProviderConfigInput>>;
  models: UpstreamModelOption[];
  modelsLoading: boolean;
  modelsError?: string | undefined;
  error?: string | undefined;
  busy?: boolean | undefined;
  onClose: () => void;
  onSave: () => void;
  onRefreshModels: () => void;
}) {
  const isEditing = Boolean(form.id);
  const title = isEditing ? `编辑 ${form.name.trim() || "Provider"}` : "新建 Provider";

  return (
    <div className="settings-modal-backdrop" onClick={onClose}>
      <div
        className="settings-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="provider-modal-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="settings-modal-header">
          <h2 id="provider-modal-title" className="settings-modal-title">
            {title}
          </h2>
          <button type="button" className="mcp-icon-button" onClick={onClose} aria-label="关闭" disabled={busy}>
            <X size={18} />
          </button>
        </header>

        <div className="settings-modal-body mcp-editor-form models-editor-form">
          <label className="mcp-field">
            <span className="mcp-field-label">名称</span>
            <input
              className="mcp-field-input"
              value={form.name}
              onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
            />
          </label>

          <label className="mcp-field">
            <span className="mcp-field-label">baseURL</span>
            <input
              className="mcp-field-input"
              value={form.baseUrl}
              onChange={(event) => setForm((current) => ({ ...current, baseUrl: event.target.value }))}
            />
          </label>

          <label className="mcp-field">
            <span className="mcp-field-label">API key</span>
            <input
              className="mcp-field-input"
              type="password"
              value={form.apiKey ?? ""}
              placeholder={form.id ? "留空则保留已保存的 Key" : "sk-..."}
              onChange={(event) => setForm((current) => ({ ...current, apiKey: event.target.value }))}
            />
          </label>

          <div className="mcp-field">
            <div className="model-field-head">
              <span className="mcp-field-label">默认模型</span>
              <button
                type="button"
                className="model-inline-refresh"
                disabled={busy || modelsLoading}
                onClick={onRefreshModels}
              >
                <RefreshCw size={14} className={modelsLoading ? "model-refresh-spin" : undefined} />
                从上游刷新
              </button>
            </div>
            <ModelSelectField
              value={form.defaultModel}
              models={models}
              loading={modelsLoading}
              error={modelsError}
              disabled={busy}
              onRefresh={onRefreshModels}
              onChange={(modelId) => setForm((current) => ({ ...current, defaultModel: modelId }))}
            />
          </div>

          <label className="mcp-field models-toggle-field">
            <span className="mcp-field-label">启用此 Provider</span>
            <label className="mcp-toggle" title={form.enabled ? "已启用" : "已禁用"}>
              <input
                type="checkbox"
                checked={form.enabled}
                disabled={busy}
                onChange={(event) => setForm((current) => ({ ...current, enabled: event.target.checked }))}
              />
              <span className="mcp-toggle-track" aria-hidden />
            </label>
          </label>

          {error && <p className="settings-form-error">{error}</p>}
        </div>

        <footer className="settings-modal-footer">
          <button type="button" className="settings-modal-cancel" onClick={onClose} disabled={busy}>
            取消
          </button>
          <button type="button" className="mcp-save-button" disabled={busy} onClick={onSave}>
            保存
          </button>
        </footer>
      </div>
    </div>
  );
}

function providerToForm(provider?: ProviderConfigView): ProviderConfigInput {
  const form: ProviderConfigInput = {
    name: provider?.name ?? "Anthropic compatible",
    baseUrl: provider?.baseUrl ?? "https://api.anthropic.com",
    apiKey: "",
    defaultModel: provider?.defaultModel ?? "sonnet",
    enabled: provider?.enabled ?? true,
  };
  if (provider) {
    form.id = provider.id;
  }
  return form;
}
