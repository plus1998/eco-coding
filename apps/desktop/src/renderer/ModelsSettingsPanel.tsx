import { DEFAULT_CONTEXT_LIMIT, formatContextLimit } from "@eco/runtime";
import { Plus, RefreshCw, Settings2, X } from "lucide-react";
import { type Dispatch, type SetStateAction, useCallback, useEffect, useMemo, useState } from "react";
import type { UpstreamModelOption } from "../shared/models";
import {
  AGENT_ROLES,
  type AgentRole,
  type ModelSettingsSnapshot,
  type ProviderConfigInput,
  type ProviderConfigView,
  type RouteCapabilityHint,
  type RoutePricingHint,
  type RoleRouteConfig,
  type ThinkingEffort,
} from "../shared/ipc";
import { ModelSelectField } from "./ModelSelectField";
import { RoutePricingDisplay } from "./RoutePricingDisplay";

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
  explore: "探索",
  architect: "架构",
  coder: "编码",
  reviewer: "审查",
  tester: "测试",
};

const THINKING_EFFORT_OPTIONS: Array<{ value: "" | ThinkingEffort; label: string }> = [
  { value: "", label: "默认" },
  { value: "off", label: "关闭" },
  { value: "low", label: "low" },
  { value: "medium", label: "medium" },
  { value: "high", label: "high" },
  { value: "xhigh", label: "xhigh" },
  { value: "max", label: "max" },
];

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
  const [routePricing, setRoutePricing] = useState<Partial<Record<AgentRole, RoutePricingHint>>>({});
  const [routeCapabilities, setRouteCapabilities] = useState<Partial<Record<AgentRole, RouteCapabilityHint>>>({});
  const [pricingLoading, setPricingLoading] = useState(false);

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
    if (modelsCache[providerForm.id]?.models.length) {
      return;
    }
    void fetchModels(providerForm, { silent: true });
  }, [providerModalOpen, providerForm, settings.providers, modelsCache, fetchModels]);

  const refreshRouteCapabilities = useCallback(async () => {
    if (!window.eco?.getRouteCapabilities) {
      return;
    }
    try {
      const hints = await window.eco.getRouteCapabilities();
      setRouteCapabilities(
        Object.fromEntries(hints.map((hint) => [hint.role, hint])) as Partial<
          Record<AgentRole, RouteCapabilityHint>
        >,
      );
    } catch {
      setRouteCapabilities({});
    }
  }, []);

  const refreshModelsDevCatalog = useCallback(async () => {
    if (!window.eco?.getRoutePricing) {
      return;
    }
    setPricingLoading(true);
    setPanelError(undefined);
    try {
      if (window.eco.refreshPricingCatalog) {
        await window.eco.refreshPricingCatalog();
      }
      const hints = await window.eco.getRoutePricing();
      setRoutePricing(Object.fromEntries(hints.map((hint) => [hint.role, hint])) as Partial<
        Record<AgentRole, RoutePricingHint>
      >);
      await refreshRouteCapabilities();
    } catch (caught) {
      setPanelError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setPricingLoading(false);
    }
  }, [refreshRouteCapabilities]);

  useEffect(() => {
    void refreshModelsDevCatalog();
  }, [settings.routes, settings.providers, refreshModelsDevCatalog]);

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
    if ("thinkingEffort" in patch) {
      if (patch.thinkingEffort) {
        nextRoute.thinkingEffort = patch.thinkingEffort;
      }
    } else if (existingRoute?.thinkingEffort) {
      nextRoute.thinkingEffort = existingRoute.thinkingEffort;
    }
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
          配置上游 Provider，并为各 Agent 角色指定调用的模型。保存后，新启动的编码线程会按角色路由选用对应 Provider 与模型。
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
        <header className="models-section-header">
          <div className="models-section-intro">
            <h2 className="models-section-title">角色路由</h2>
            <p className="models-section-desc">
              为规划、探索、架构、编码、审查、测试分别指定 Provider 与模型。线程运行到对应角色时，会调用此处配置的路线。
            </p>
            <p className="models-section-meta">
              能力、上下文上限与参考单价来自 models.dev；未匹配时请自行确认模型规格。
            </p>
          </div>
          <div className="models-section-actions">
            <button
              type="button"
              className="models-section-button"
              disabled={busy || pricingLoading}
              onClick={() => void refreshModelsDevCatalog()}
            >
              刷新 models.dev
            </button>
            <button
              type="button"
              className="models-section-button models-section-button-primary"
              disabled={busy}
              onClick={() => void saveRoutes()}
            >
              保存路由
            </button>
          </div>
        </header>

        <ul className="models-route-list">
          {AGENT_ROLES.map((role) => {
            const route = settings.routes.find((candidate) => candidate.role === role);
            const providerId = route?.providerId ?? settings.providers[0]?.id ?? "";
            const routeModels = modelsForProvider(providerId);
            const routeLoading = loadingForProvider(providerId);
            const routeError = modelsErrorForProvider(providerId);
            const pricing = routePricing[role];
            const capability = routeCapabilities[role];
            const effortDisabled =
              capability?.capabilitiesResolved === true && capability.supportsReasoning === false;

            return (
              <li key={role} className="models-route-card">
                <div className="models-route-card-head">
                  <div className="models-route-card-identity">
                    <span className="models-route-role">{ROLE_LABELS[role]}</span>
                    <span className="models-route-role-id">{role}</span>
                    <span className="models-route-capability-badges">
                      {capability?.capabilitiesResolved ? (
                        <>
                          {capability.supportsImageInput && (
                            <span className="models-route-capability-badge" title="支持图片输入">
                              视觉
                            </span>
                          )}
                          {capability.supportsReasoning && (
                            <span className="models-route-capability-badge" title="支持思考链">
                              推理
                            </span>
                          )}
                        </>
                      ) : (
                        <span
                          className="models-route-capability-badge models-route-capability-badge-unresolved"
                          title="未匹配 models.dev"
                        >
                          能力 ?
                        </span>
                      )}
                      {route?.modelId ? (
                        capability?.contextLimitResolved && capability.contextTokens ? (
                          <span
                            className="models-route-capability-badge"
                            title={
                              capability.maxOutputTokens
                                ? `上下文窗口 ${capability.contextTokens.toLocaleString()} tokens · 单次最大输出 ${capability.maxOutputTokens.toLocaleString()} tokens`
                                : `上下文窗口 ${capability.contextTokens.toLocaleString()} tokens`
                            }
                          >
                            上下文 {formatContextLimit(capability.contextTokens)}
                          </span>
                        ) : (
                          <span
                            className="models-route-capability-badge models-route-capability-badge-unresolved"
                            title={`上下文上限未匹配 models.dev，按 ${DEFAULT_CONTEXT_LIMIT.toLocaleString()}（${formatContextLimit(DEFAULT_CONTEXT_LIMIT)}）估算`}
                          >
                            上下文 ~{formatContextLimit(DEFAULT_CONTEXT_LIMIT)}
                          </span>
                        )
                      ) : null}
                    </span>
                  </div>
                  {pricing?.rates ? (
                    <RoutePricingDisplay
                      rates={pricing.rates}
                      {...(pricing.pricingLabel && { title: pricing.pricingLabel })}
                    />
                  ) : pricing && !pricing.pricingResolved ? (
                    <span className="models-route-pricing-badge models-route-pricing-badge-unresolved">
                      未匹配参考单价
                    </span>
                  ) : null}
                </div>
                <div className="models-route-card-fields">
                  <label className="mcp-field models-route-field">
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
                        if (provider && !modelsCache[nextProviderId]?.models.length) {
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
                  <div className="mcp-field models-route-field">
                    <span className="mcp-field-label">模型</span>
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
                  <label className="mcp-field models-route-field">
                    <span className="mcp-field-label">思考链</span>
                    <select
                      className="mcp-field-input"
                      value={route?.thinkingEffort ?? ""}
                      disabled={busy || effortDisabled}
                      title={
                        effortDisabled
                          ? "该模型在 models.dev 中标记为不支持推理"
                          : capability && !capability.capabilitiesResolved
                            ? "未匹配 models.dev，请自行确认"
                            : undefined
                      }
                      onChange={(event) => {
                        const value = event.target.value;
                        updateRoute(role, {
                          thinkingEffort:
                            value === "" ? undefined : (value as ThinkingEffort),
                        });
                      }}
                    >
                      {THINKING_EFFORT_OPTIONS.map((option) => (
                        <option key={option.value || "default"} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    {effortDisabled && (
                      <span className="models-route-field-hint">该模型不支持推理</span>
                    )}
                    {capability && !capability.capabilitiesResolved && (
                      <span className="models-route-field-hint">未匹配 models.dev，请自行确认</span>
                    )}
                  </label>
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
              placeholder={form.id ? "留空则保留已保存的 Key" : "可选，本地 Ollama 等可留空"}
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
