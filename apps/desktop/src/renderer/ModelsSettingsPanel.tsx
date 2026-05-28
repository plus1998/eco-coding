import { Plus, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
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
  busy?: boolean;
  onSettingsChange: (settings: ModelSettingsSnapshot) => void;
  onSavingChange?: (saving: boolean) => void;
}

interface ModelsCacheEntry {
  models: UpstreamModelOption[];
  error?: string;
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
  const [providerForm, setProviderForm] = useState<ProviderConfigInput>(() =>
    providerToForm(settings.providers[0]),
  );
  const [modelsCache, setModelsCache] = useState<Record<string, ModelsCacheEntry>>({});
  const [loadingProviderId, setLoadingProviderId] = useState<string | null>(null);
  const [panelError, setPanelError] = useState<string>();

  const activeProviderId = providerForm.id ?? "__draft__";
  const activeCache = modelsCache[activeProviderId];

  const refreshSettings = useCallback(async () => {
    if (!window.eco) {
      return;
    }
    const snapshot = await window.eco.getModelSettings();
    onSettingsChange(snapshot);
    if (providerForm.id) {
      const saved = snapshot.providers.find((provider) => provider.id === providerForm.id);
      if (saved) {
        setProviderForm(providerToForm(saved));
      }
    }
  }, [onSettingsChange, providerForm.id]);

  const fetchModels = useCallback(
    async (target: ProviderConfigInput, options?: { silent?: boolean }) => {
      if (!window.eco) {
        return;
      }
      const cacheKey = target.id ?? "__draft__";
      setLoadingProviderId(cacheKey);
      if (!options?.silent) {
        setPanelError(undefined);
      }

      try {
        const result = await window.eco.listProviderModels({
          providerId: target.id,
          baseUrl: target.baseUrl,
          apiKey: target.apiKey,
        });
        if (!result.ok) {
          setModelsCache((current) => ({
            ...current,
            [cacheKey]: { models: current[cacheKey]?.models ?? [], error: result.error },
          }));
          if (!options?.silent) {
            setPanelError(result.error);
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
          setPanelError(message);
        }
      } finally {
        setLoadingProviderId(null);
      }
    },
    [],
  );

  useEffect(() => {
    const provider = settings.providers.find((entry) => entry.id === providerForm.id) ?? settings.providers[0];
    if (provider && provider.id !== providerForm.id) {
      setProviderForm(providerToForm(provider));
    }
  }, [settings.providers, providerForm.id]);

  useEffect(() => {
    if (!providerForm.id) {
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
  }, [providerForm.id, settings.providers, modelsCache, fetchModels]);

  const modelsForProvider = useCallback(
    (providerId: string): UpstreamModelOption[] => {
      if (providerId === activeProviderId) {
        return activeCache?.models ?? [];
      }
      return modelsCache[providerId]?.models ?? [];
    },
    [activeCache?.models, activeProviderId, modelsCache],
  );

  const modelsErrorForProvider = useCallback(
    (providerId: string): string | undefined => {
      if (providerId === activeProviderId) {
        return activeCache?.error;
      }
      return modelsCache[providerId]?.error;
    },
    [activeCache?.error, activeProviderId, modelsCache],
  );

  const loadingForProvider = useCallback(
    (providerId: string) => loadingProviderId === providerId || loadingProviderId === "__draft__",
    [loadingProviderId],
  );

  async function saveProvider() {
    if (!window.eco) {
      return;
    }
    setPanelError(undefined);
    onSavingChange?.(true);
    try {
      const provider = await window.eco.saveProvider(providerForm);
      await refreshSettings();
      setProviderForm(providerToForm(provider));
      await fetchModels(providerToForm(provider));
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
          <button
            type="button"
            className="mcp-add-button"
            disabled={busy}
            onClick={() => {
              setPanelError(undefined);
              setProviderForm(providerToForm());
            }}
          >
            <Plus size={16} />
            添加 Provider
          </button>
        </div>

        {providerOptions.length === 0 ? (
          <p className="mcp-list-empty">尚未添加 Provider</p>
        ) : (
          <ul className="mcp-server-list models-provider-list">
            {providerOptions.map((provider) => (
              <li key={provider.id}>
                <button
                  type="button"
                  className={
                    providerForm.id === provider.id ? "models-provider-row active" : "models-provider-row"
                  }
                  onClick={() => {
                    setPanelError(undefined);
                    setProviderForm(providerToForm(provider));
                  }}
                >
                  <div className="models-provider-row-main">
                    <span className="mcp-server-name">{provider.name}</span>
                    <small>
                      {provider.defaultModel}
                      {provider.hasApiKey ? " · 已配置 Key" : " · 无 Key"}
                    </small>
                  </div>
                  <span className={provider.enabled ? "models-provider-badge on" : "models-provider-badge"}>
                    {provider.enabled ? "已启用" : "已禁用"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="models-editor-section">
        <div className="mcp-editor-title-block">
          <h2 className="models-editor-title">{providerForm.id ? "编辑 Provider" : "新建 Provider"}</h2>
        </div>

        <div className="mcp-editor-form models-editor-form">
          <label className="mcp-field">
            <span className="mcp-field-label">名称</span>
            <input
              className="mcp-field-input"
              value={providerForm.name}
              onChange={(event) => setProviderForm((current) => ({ ...current, name: event.target.value }))}
            />
          </label>

          <label className="mcp-field">
            <span className="mcp-field-label">baseURL</span>
            <input
              className="mcp-field-input"
              value={providerForm.baseUrl}
              onChange={(event) => setProviderForm((current) => ({ ...current, baseUrl: event.target.value }))}
            />
          </label>

          <label className="mcp-field">
            <span className="mcp-field-label">API key</span>
            <input
              className="mcp-field-input"
              type="password"
              value={providerForm.apiKey ?? ""}
              placeholder={providerForm.id ? "留空则保留已保存的 Key" : "sk-..."}
              onChange={(event) => setProviderForm((current) => ({ ...current, apiKey: event.target.value }))}
            />
          </label>

          <div className="mcp-field">
            <div className="model-field-head">
              <span className="mcp-field-label">默认模型</span>
              <button
                type="button"
                className="model-inline-refresh"
                disabled={busy || loadingForProvider(activeProviderId)}
                onClick={() => void fetchModels(providerForm)}
              >
                <RefreshCw size={14} className={loadingForProvider(activeProviderId) ? "model-refresh-spin" : undefined} />
                从上游刷新
              </button>
            </div>
            <ModelSelectField
              value={providerForm.defaultModel}
              models={activeCache?.models ?? []}
              loading={loadingForProvider(activeProviderId)}
              error={activeCache?.error}
              disabled={busy}
              onRefresh={() => void fetchModels(providerForm)}
              onChange={(modelId) => setProviderForm((current) => ({ ...current, defaultModel: modelId }))}
            />
          </div>

          <label className="mcp-field models-toggle-field">
            <span className="mcp-field-label">启用此 Provider</span>
            <label className="mcp-toggle" title={providerForm.enabled ? "已启用" : "已禁用"}>
              <input
                type="checkbox"
                checked={providerForm.enabled}
                disabled={busy}
                onChange={(event) =>
                  setProviderForm((current) => ({ ...current, enabled: event.target.checked }))
                }
              />
              <span className="mcp-toggle-track" aria-hidden />
            </label>
          </label>

          <button type="button" className="mcp-save-button" disabled={busy} onClick={() => void saveProvider()}>
            保存 Provider
          </button>
        </div>
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
    </>
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
