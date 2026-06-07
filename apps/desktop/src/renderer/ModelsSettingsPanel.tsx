import { DEFAULT_CONTEXT_LIMIT, formatContextLimit } from "@eco/runtime";
import { Plus, RefreshCw, Settings2, Trash2, X } from "lucide-react";
import { type Dispatch, type SetStateAction, useCallback, useEffect, useMemo, useState } from "react";
import { ROUTE_TEST_THINKING_EFFORT, type UpstreamModelOption } from "../shared/models";
import { UPSTREAM_API_COMPAT_OPTIONS } from "../shared/api-compat";
import { ApiCompatToggle } from "./ApiCompatToggle";
import { isOpenAICompat } from "../shared/api-compat";
import {
  AGENT_ROLES,
  SUBAGENT_ROLES,
  type AgentRole,
  type SubagentEnabledSettings,
  type SubagentRole,
  type ModelSettingsSnapshot,
  type ProviderConfigInput,
  type ProviderConfigView,
  type RouteCapabilityHint,
  type RoutePricingHint,
  type RoleRouteConfig,
  type RouteProfileInput,
  type RouteProfileView,
  type RouteManualSpec,
  type ModelsDevModelOption,
  type RoleRouteTestResult,
  type ThinkingEffort,
} from "../shared/ipc";
import { ModelSelectField } from "./ModelSelectField";
import { ModelsDevModelSelectField } from "./ModelsDevModelSelectField";
import { RoutePricingDisplay } from "./RoutePricingDisplay";
import { AppMessage, formatDurationMs, type AppMessageKind } from "./AppMessage";
import { SubagentSettingsSection } from "./SubagentSettingsSection";
import { ProxyBridgeSettingsSection } from "./ProxyBridgeSettingsSection";
import { WorkflowSettingsSection } from "./WorkflowSettingsSection";
import type { ProxyBridgeSettingsSnapshot, WorkflowSettingsSnapshot } from "../shared/ipc";

export type ModelsSettingsTab = "providers" | "subagents" | "routes";

const MODELS_TAB_ITEMS: Array<{ id: ModelsSettingsTab; label: string }> = [
  { id: "providers", label: "提供商和模型" },
  { id: "subagents", label: "子代理库" },
  { id: "routes", label: "子代理编排" },
];

interface ModelsSettingsPanelProps {
  settings: ModelSettingsSnapshot;
  subagentSettings: SubagentEnabledSettings;
  workflowSettings: WorkflowSettingsSnapshot;
  proxyBridgeSettings: ProxyBridgeSettingsSnapshot;
  subagentSettingsSaving?: boolean | undefined;
  workflowSettingsSaving?: boolean | undefined;
  proxyBridgeSettingsSaving?: boolean | undefined;
  busy?: boolean | undefined;
  initialTab?: ModelsSettingsTab | undefined;
  onSettingsChange: (settings: ModelSettingsSnapshot) => void;
  onSubagentSettingsChange: (settings: SubagentEnabledSettings) => void;
  onWorkflowSettingsChange: (settings: WorkflowSettingsSnapshot) => void;
  onProxyBridgeSettingsChange: (settings: ProxyBridgeSettingsSnapshot) => void;
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
  subagentSettings,
  workflowSettings,
  proxyBridgeSettings,
  subagentSettingsSaving,
  workflowSettingsSaving,
  proxyBridgeSettingsSaving,
  busy,
  initialTab = "providers",
  onSettingsChange,
  onSubagentSettingsChange,
  onWorkflowSettingsChange,
  onProxyBridgeSettingsChange,
  onSavingChange,
}: ModelsSettingsPanelProps) {
  const [activeTab, setActiveTab] = useState<ModelsSettingsTab>(initialTab);
  const [providerModalOpen, setProviderModalOpen] = useState(false);
  const [providerForm, setProviderForm] = useState<ProviderConfigInput>(() => providerToForm());
  const [routeProfileModalOpen, setRouteProfileModalOpen] = useState(false);
  const [routeProfileForm, setRouteProfileForm] = useState<RouteProfileInput>(() => createBlankRouteProfileForm());
  const [modelsCache, setModelsCache] = useState<Record<string, ModelsCacheEntry>>({});
  const [loadingProviderId, setLoadingProviderId] = useState<string | null>(null);
  const [panelError, setPanelError] = useState<string>();
  const [modalError, setModalError] = useState<string>();
  const [routeProfileModalError, setRouteProfileModalError] = useState<string>();
  const [routePricing, setRoutePricing] = useState<Partial<Record<AgentRole, RoutePricingHint>>>({});
  const [routeCapabilities, setRouteCapabilities] = useState<Partial<Record<AgentRole, RouteCapabilityHint>>>({});
  const [pricingLoading, setPricingLoading] = useState(false);
  const [modelsDevOptions, setModelsDevOptions] = useState<ModelsDevModelOption[]>([]);
  const [modelsDevLoading, setModelsDevLoading] = useState(false);
  const [testingProviderKey, setTestingProviderKey] = useState<string | null>(null);
  const [testingRouteProfileId, setTestingRouteProfileId] = useState<string | null>(null);
  const [testingRouteRole, setTestingRouteRole] = useState<AgentRole | null>(null);
  const [routeTestResults, setRouteTestResults] = useState<Partial<Record<AgentRole, RoleRouteTestResult>>>(
    {},
  );
  const [providerTestMessage, setProviderTestMessage] = useState<{
    kind: AppMessageKind;
    message: string;
  }>();
  const [routeTestMessage, setRouteTestMessage] = useState<{
    kind: AppMessageKind;
    message: string;
  }>();

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

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
          ...(target.requestPath !== undefined && target.requestPath !== ""
            ? { requestPath: target.requestPath }
            : {}),
          ...(target.apiCompat && { apiCompat: target.apiCompat }),
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
    const cached = modelsCache[providerForm.id];
    if (cached?.models.length || cached?.error) {
      return;
    }
    void fetchModels(providerForm, { silent: true });
  }, [providerModalOpen, providerForm, settings.providers, modelsCache, fetchModels]);

  useEffect(() => {
    if (!routeProfileModalOpen) {
      return;
    }
    for (const route of routeProfileForm.routes) {
      if (!route.providerId) {
        continue;
      }
      const cached = modelsCache[route.providerId];
      if (cached?.models.length || cached?.error) {
        continue;
      }
      const provider = settings.providers.find((entry) => entry.id === route.providerId);
      if (provider) {
        void fetchModels(providerToForm(provider), { silent: true });
      }
    }
  }, [routeProfileModalOpen, routeProfileForm.routes, settings.providers, modelsCache, fetchModels]);

  const refreshRouteCapabilities = useCallback(async (routes?: RoleRouteConfig[]) => {
    if (!window.eco?.getRouteCapabilities) {
      return;
    }
    try {
      const hints = await window.eco.getRouteCapabilities(routes);
      setRouteCapabilities(
        Object.fromEntries(hints.map((hint) => [hint.role, hint])) as Partial<
          Record<AgentRole, RouteCapabilityHint>
        >,
      );
    } catch {
      setRouteCapabilities({});
    }
  }, []);

  const refreshModelsDevCatalog = useCallback(
    async (routes?: RoleRouteConfig[]) => {
      if (!window.eco?.getRoutePricing) {
        return;
      }
      setPricingLoading(true);
      setPanelError(undefined);
      try {
        if (window.eco.refreshPricingCatalog) {
          await window.eco.refreshPricingCatalog();
        }
        const hints = await window.eco.getRoutePricing(routes);
        setRoutePricing(Object.fromEntries(hints.map((hint) => [hint.role, hint])) as Partial<
          Record<AgentRole, RoutePricingHint>
        >);
        await refreshRouteCapabilities(routes);
      } catch (caught) {
        setPanelError(caught instanceof Error ? caught.message : String(caught));
      } finally {
        setPricingLoading(false);
      }
    },
    [refreshRouteCapabilities],
  );

  useEffect(() => {
    if (!routeProfileModalOpen || !window.eco?.listModelsDevModels) {
      return;
    }
    setModelsDevLoading(true);
    void window.eco
      .listModelsDevModels()
      .then((options) => setModelsDevOptions(options))
      .catch(() => setModelsDevOptions([]))
      .finally(() => setModelsDevLoading(false));
  }, [routeProfileModalOpen]);

  useEffect(() => {
    if (!routeProfileModalOpen) {
      return;
    }
    void refreshModelsDevCatalog(routeProfileForm.routes);
  }, [routeProfileModalOpen, routeProfileForm.routes, settings.providers, refreshModelsDevCatalog]);

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

  function showProviderTestMessage(kind: AppMessageKind, message: string) {
    setProviderTestMessage({ kind, message });
  }

  function closeProviderModal() {
    setProviderModalOpen(false);
    setModalError(undefined);
    setProviderForm(providerToForm());
  }

  function openCreateRouteProfile() {
    setPanelError(undefined);
    setRouteProfileModalError(undefined);
    setRouteTestResults({});
    setRouteTestMessage(undefined);
    setRouteProfileForm(createBlankRouteProfileForm(settings));
    setRouteProfileModalOpen(true);
  }

  function openEditRouteProfile(profile: RouteProfileView) {
    setPanelError(undefined);
    setRouteProfileModalError(undefined);
    setRouteTestResults({});
    setRouteTestMessage(undefined);
    setRouteProfileForm(routeProfileToForm(profile));
    setRouteProfileModalOpen(true);
  }

  function closeRouteProfileModal() {
    setRouteProfileModalOpen(false);
    setRouteProfileModalError(undefined);
    setRouteTestResults({});
    setRouteTestMessage(undefined);
    setTestingRouteRole(null);
    setTestingRouteProfileId(null);
    setRouteProfileForm(createBlankRouteProfileForm(settings));
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

  async function deleteProvider() {
    if (!window.eco || !providerForm.id) {
      return;
    }
    if (settings.providers.length <= 1) {
      setModalError("至少保留一个 Provider。");
      return;
    }
    const providerName = providerForm.name.trim() || "Provider";
    if (!window.confirm(`确定删除 Provider「${providerName}」？引用它的子代理编排配置将改用到其他 Provider。`)) {
      return;
    }

    const deletedId = providerForm.id;
    setModalError(undefined);
    onSavingChange?.(true);
    try {
      await window.eco.deleteProvider(deletedId);
      await refreshSettings();
      setModelsCache((current) => {
        const next = { ...current };
        delete next[deletedId];
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

  async function testSingleRoute(route: RoleRouteConfig, profileKey?: string) {
    if (!window.eco?.testRouteProfile) {
      return;
    }
    if (!route.providerId.trim() || !route.modelId.trim()) {
      setRouteTestMessage({
        kind: "error",
        message: `请先为「${ROLE_LABELS[route.role]}」选择 Provider 与模型。`,
      });
      return;
    }

    const testKey = profileKey ?? routeProfileForm.id ?? "__draft__";
    setTestingRouteProfileId(testKey);
    setTestingRouteRole(route.role);
    setRouteTestMessage(undefined);

    try {
      const result = await window.eco.testRouteProfile({
        routes: [
          {
            role: route.role,
            providerId: route.providerId,
            modelId: route.modelId,
            ...(route.apiCompat && { apiCompat: route.apiCompat }),
            thinkingEffort: ROUTE_TEST_THINKING_EFFORT,
          },
        ],
      });
      const entry = result.results[0];
      if (entry) {
        setRouteTestResults((current) => ({
          ...current,
          [route.role]: entry,
        }));
      }
      if (entry?.ok) {
        const duration =
          entry.elapsedMs !== undefined ? `，耗时 ${formatDurationMs(entry.elapsedMs)}` : "";
        setRouteTestMessage({
          kind: "success",
          message: `「${ROLE_LABELS[route.role]}」测试通过${duration}`,
        });
      } else {
        setRouteTestMessage({
          kind: "error",
          message: `「${ROLE_LABELS[route.role]}」测试失败：${entry?.error ?? "未知错误"}`,
        });
      }
    } catch (caught) {
      setRouteTestMessage({
        kind: "error",
        message: caught instanceof Error ? caught.message : String(caught),
      });
    } finally {
      setTestingRouteRole(null);
      setTestingRouteProfileId(null);
    }
  }

  async function testRouteProfile(routes: RoleRouteConfig[], profileKey?: string) {
    if (!window.eco?.testRouteProfile) {
      return;
    }
    const testKey = profileKey ?? routeProfileForm.id ?? "__draft__";
    setTestingRouteProfileId(testKey);
    setTestingRouteRole(null);
    setRouteTestMessage(undefined);
    setRouteTestResults({});

    try {
      const result = await window.eco.testRouteProfile({
        routes: routes.map((route) => ({
          role: route.role,
          providerId: route.providerId,
          modelId: route.modelId,
          ...(route.apiCompat && { apiCompat: route.apiCompat }),
          thinkingEffort: ROUTE_TEST_THINKING_EFFORT,
        })),
      });
      setRouteTestResults(
        Object.fromEntries(result.results.map((entry) => [entry.role as AgentRole, entry])) as Partial<
          Record<AgentRole, RoleRouteTestResult>
        >,
      );

      if (result.failed === 0) {
        const uniqueModels = new Set(
          routes
            .filter((route) => route.providerId.trim() && route.modelId.trim())
            .map(
              (route) =>
                `${route.providerId.trim()}:${route.modelId.trim()}:${route.apiCompat ?? ""}`,
            ),
        );
        const durations = result.results
          .map((entry) => (entry.elapsedMs !== undefined ? formatDurationMs(entry.elapsedMs) : undefined))
          .filter(Boolean);
        const durationHint = durations.length > 0 ? `，耗时 ${durations[0]}` : "";
        const dedupeHint =
          uniqueModels.size < result.passed
            ? `（${uniqueModels.size} 组 Provider+模型，共 ${result.passed} 个角色）`
            : "";
        setRouteTestMessage({
          kind: "success",
          message: `全部 ${result.passed} 个角色已通过 /v1/messages 测试${dedupeHint}${durationHint}`,
        });
      } else {
        const failedLabels = result.results
          .filter((entry) => !entry.ok)
          .map((entry) => `${ROLE_LABELS[entry.role as AgentRole] ?? entry.role}：${entry.error ?? "失败"}`)
          .join("；");
        setRouteTestMessage({
          kind: "error",
          message: `${result.passed}/${result.results.length} 通过。失败：${failedLabels}`,
        });
      }
    } catch (caught) {
      setRouteTestMessage({
        kind: "error",
        message: caught instanceof Error ? caught.message : String(caught),
      });
    } finally {
      setTestingRouteProfileId(null);
      setTestingRouteRole(null);
    }
  }

  async function testProvider(target: ProviderConfigInput) {
    if (!window.eco?.testProviderConnection) {
      return;
    }
    const providerName = target.name.trim() || "Provider";
    if (!target.baseUrl.trim()) {
      showProviderTestMessage("error", "请先填写 baseURL。");
      return;
    }
    if (!target.defaultModel.trim()) {
      showProviderTestMessage("error", "请先选择默认模型。");
      return;
    }

    const feedbackKey = target.id ?? "__draft__";
    setTestingProviderKey(feedbackKey);

    const startedAt = performance.now();
    try {
      const result = await window.eco.testProviderConnection({
        baseUrl: target.baseUrl,
        ...(target.requestPath !== undefined && { requestPath: target.requestPath }),
        ...(target.apiCompat && { apiCompat: target.apiCompat }),
        defaultModel: target.defaultModel,
        thinkingEffort: ROUTE_TEST_THINKING_EFFORT,
        ...(target.id && { providerId: target.id }),
        ...(target.apiKey && { apiKey: target.apiKey }),
      });
      if (result.ok) {
        const duration = formatDurationMs(performance.now() - startedAt);
        showProviderTestMessage("success", `「${providerName}」测试成功，耗时 ${duration}`);
      } else {
        showProviderTestMessage("error", result.error ?? "测试失败。");
      }
    } catch (caught) {
      showProviderTestMessage(
        "error",
        caught instanceof Error ? caught.message : String(caught),
      );
    } finally {
      setTestingProviderKey(null);
    }
  }

  async function saveRouteProfile() {
    if (!window.eco) {
      return;
    }
    setRouteProfileModalError(undefined);
    onSavingChange?.(true);
    try {
      await window.eco.saveRouteProfile(routeProfileForm);
      await refreshSettings();
      closeRouteProfileModal();
    } catch (caught) {
      setRouteProfileModalError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      onSavingChange?.(false);
    }
  }

  async function deleteRouteProfile() {
    if (!window.eco || !routeProfileForm.id) {
      return;
    }
    if (settings.routeProfiles.length <= 1) {
      setRouteProfileModalError("至少保留一套子代理编排配置。");
      return;
    }
    const profileName = routeProfileForm.name.trim() || "路由配置";
    if (!window.confirm(`确定删除路由配置「${profileName}」？`)) {
      return;
    }

    setRouteProfileModalError(undefined);
    onSavingChange?.(true);
    try {
      await window.eco.deleteRouteProfile(routeProfileForm.id);
      await refreshSettings();
      closeRouteProfileModal();
    } catch (caught) {
      setRouteProfileModalError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      onSavingChange?.(false);
    }
  }

  function updateRouteInForm(
    role: AgentRole,
    patch: Partial<RoleRouteConfig>,
    options?: {
      clearThinkingEffort?: boolean;
      clearModelsDevMapping?: boolean;
      clearManualSpec?: boolean;
    },
  ) {
    setRouteProfileForm((current) => {
      const existingRoute = current.routes.find((route) => route.role === role);
      const defaultProvider = settings.providers.find(
        (entry) => entry.id === (patch.providerId ?? existingRoute?.providerId ?? settings.providers[0]?.id),
      );
      const nextRoute: RoleRouteConfig = {
        role,
        providerId: patch.providerId ?? existingRoute?.providerId ?? settings.providers[0]?.id ?? "",
        modelId: patch.modelId ?? existingRoute?.modelId ?? settings.providers[0]?.defaultModel ?? "",
      };
      if (patch.apiCompat) {
        nextRoute.apiCompat = patch.apiCompat;
      } else if (existingRoute?.apiCompat) {
        nextRoute.apiCompat = existingRoute.apiCompat;
      } else if (defaultProvider) {
        nextRoute.apiCompat = defaultProvider.apiCompat;
      }
      if (options?.clearThinkingEffort) {
        // omit thinkingEffort
      } else if (patch.thinkingEffort) {
        nextRoute.thinkingEffort = patch.thinkingEffort;
      } else if (existingRoute?.thinkingEffort) {
        nextRoute.thinkingEffort = existingRoute.thinkingEffort;
      }
      if (options?.clearModelsDevMapping) {
        // omit modelsDevMapping
      } else if (patch.modelsDevMapping) {
        nextRoute.modelsDevMapping = patch.modelsDevMapping;
      } else if (existingRoute?.modelsDevMapping) {
        nextRoute.modelsDevMapping = existingRoute.modelsDevMapping;
      }
      if (options?.clearManualSpec) {
        // omit manualSpec
      } else if (patch.manualSpec !== undefined) {
        nextRoute.manualSpec = patch.manualSpec;
      } else if (existingRoute?.manualSpec) {
        nextRoute.manualSpec = existingRoute.manualSpec;
      }
      return {
        ...current,
        routes: [...current.routes.filter((route) => route.role !== role), nextRoute],
      };
    });
  }

  const providerOptions = useMemo(() => settings.providers, [settings.providers]);

  return (
    <>
      {providerTestMessage && (
        <AppMessage
          kind={providerTestMessage.kind}
          message={providerTestMessage.message}
          onDismiss={() => setProviderTestMessage(undefined)}
        />
      )}
      {routeTestMessage && (
        <AppMessage
          kind={routeTestMessage.kind}
          message={routeTestMessage.message}
          onDismiss={() => setRouteTestMessage(undefined)}
        />
      )}

      <header className="mcp-page-header">
        <h1>模型与路由</h1>
        <p className="mcp-page-desc">
          配置 Provider、子代理库与子代理编排配置。新对话在输入区选择方案；子代理与编排策略按对话独立保存。
        </p>
      </header>

      <div className="models-settings-tabs" role="tablist" aria-label="模型设置分类">
        {MODELS_TAB_ITEMS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            className={activeTab === tab.id ? "models-settings-tab active" : "models-settings-tab"}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {panelError && <p className="settings-form-error mcp-list-error">{panelError}</p>}

      {activeTab === "subagents" && (
        <div className="models-subagents-tab">
          <WorkflowSettingsSection
            settings={workflowSettings}
            disabled={busy || workflowSettingsSaving}
            onChange={onWorkflowSettingsChange}
          />
          <section className="mcp-list-section models-subagent-section">
            <header className="models-section-header">
              <div className="models-section-intro">
                <h2 className="models-section-title">子代理库</h2>
                <p className="models-section-desc">
                  {workflowSettings.orchestrationMode === "manual"
                    ? "固定编排下可停用部分子代理声明；停用后不会注册到 SDK。"
                    : "自主编排下使用当前子代理声明集合，由主 Agent 按任务目标选用。"}
                </p>
              </div>
            </header>
            <SubagentSettingsSection
              settings={subagentSettings}
              saving={subagentSettingsSaving}
              disabled={busy || workflowSettings.orchestrationMode === "autonomous"}
              onChange={onSubagentSettingsChange}
            />
          </section>
        </div>
      )}

      {activeTab === "providers" && (
      <>
      <ProxyBridgeSettingsSection
        settings={proxyBridgeSettings}
        disabled={busy || proxyBridgeSettingsSaving}
        onSave={onProxyBridgeSettingsChange}
      />
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
            {providerOptions.map((provider) => {
              const testing = testingProviderKey === provider.id;
              return (
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
                    className="models-section-button"
                    disabled={busy || testing}
                    onClick={() => void testProvider(providerToForm(provider))}
                  >
                    <RefreshCw size={14} className={testing ? "model-refresh-spin" : undefined} />
                    测试
                  </button>
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
            );
            })}
          </ul>
        )}
      </section>
      </>
      )}

      {activeTab === "routes" && (
      <section className="mcp-list-section models-routes-section">
        <header className="models-section-header">
          <div className="models-section-intro">
            <h2 className="models-section-title">子代理编排</h2>
            <p className="models-section-desc">
              可保存多套子代理编排配置。每个对话在输入区选择方案；运行到对应 agent 时使用该对话绑定的模型路线。
            </p>
            <p className="models-section-meta">
              能力、上下文与参考单价优先来自 models.dev；未匹配时可手动填写，并用「测试」验证各角色模型能否调用
              /v1/messages。
            </p>
          </div>
        </header>

        <div className="mcp-list-toolbar">
          <span className="mcp-list-toolbar-label">编排配置</span>
          <button type="button" className="mcp-add-button" disabled={busy} onClick={openCreateRouteProfile}>
            <Plus size={16} />
            添加配置
          </button>
        </div>

        {settings.routeProfiles.length === 0 ? (
          <p className="mcp-list-empty">尚未添加子代理编排配置</p>
        ) : (
          <ul className="mcp-server-list">
            {settings.routeProfiles.map((profile) => (
              <li key={profile.id} className="mcp-server-row models-route-profile-row">
                <div className="models-provider-row-main">
                  <span className="mcp-server-name">{profile.name}</span>
                  <RouteProfilePreview profile={profile} />
                </div>
                <div className="mcp-server-actions">
                  <button
                    type="button"
                    className="models-section-button"
                    disabled={busy || testingRouteProfileId !== null}
                    onClick={() => void testRouteProfile(profile.routes, profile.id)}
                  >
                    <RefreshCw
                      size={14}
                      className={testingRouteProfileId === profile.id ? "model-refresh-spin" : undefined}
                    />
                    测试
                  </button>
                  <button
                    type="button"
                    className="mcp-icon-button"
                    onClick={() => openEditRouteProfile(profile)}
                    aria-label={`编辑 ${profile.name}`}
                    disabled={busy}
                  >
                    <Settings2 size={18} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
      )}

      {providerModalOpen && (
        <ProviderEditorModal
          form={providerForm}
          setForm={setProviderForm}
          models={modalCache?.models ?? []}
          modelsLoading={loadingForProvider(modalProviderId)}
          modelsError={modalCache?.error}
          error={modalError}
          testing={testingProviderKey === modalProviderId}
          busy={busy}
          canDelete={settings.providers.length > 1}
          onClose={closeProviderModal}
          onSave={() => void saveProvider()}
          onDelete={() => void deleteProvider()}
          onRefreshModels={() => void fetchModels(providerForm)}
          onTest={() => void testProvider(providerForm)}
        />
      )}

      {routeProfileModalOpen && (
        <RouteProfileEditorModal
          form={routeProfileForm}
          setForm={setRouteProfileForm}
          providers={settings.providers}
          routePricing={routePricing}
          routeCapabilities={routeCapabilities}
          modelsDevOptions={modelsDevOptions}
          modelsDevLoading={modelsDevLoading}
          modelsForProvider={modelsForProvider}
          modelsErrorForProvider={modelsErrorForProvider}
          loadingForProvider={loadingForProvider}
          error={routeProfileModalError}
          busy={busy}
          canDelete={settings.routeProfiles.length > 1}
          pricingLoading={pricingLoading}
          testingAll={testingRouteProfileId === (routeProfileForm.id ?? "__draft__") && !testingRouteRole}
          testingRole={testingRouteRole}
          routeTestResults={routeTestResults}
          subagentSettings={subagentSettings}
          onClose={closeRouteProfileModal}
          onSave={() => void saveRouteProfile()}
          onDelete={() => void deleteRouteProfile()}
          onRefreshModelsDev={() => void refreshModelsDevCatalog(routeProfileForm.routes)}
          onTestAll={() =>
            void testRouteProfile(routeProfileForm.routes, routeProfileForm.id ?? "__draft__")
          }
          onTestRole={(role) => {
            const route = routeProfileForm.routes.find((entry) => entry.role === role);
            if (route) {
              void testSingleRoute(route, routeProfileForm.id ?? "__draft__");
            }
          }}
          onUpdateRoute={updateRouteInForm}
          onFetchModels={(provider) => void fetchModels(providerToForm(provider))}
        />
      )}
    </>
  );
}

function RouteProfileEditorModal({
  form,
  setForm,
  providers,
  routePricing,
  routeCapabilities,
  modelsDevOptions,
  modelsDevLoading,
  modelsForProvider,
  modelsErrorForProvider,
  loadingForProvider,
  error,
  busy,
  canDelete,
  pricingLoading,
  testingAll,
  testingRole,
  routeTestResults,
  onClose,
  onSave,
  onDelete,
  onRefreshModelsDev,
  onTestAll,
  onTestRole,
  onUpdateRoute,
  onFetchModels,
  subagentSettings,
}: {
  form: RouteProfileInput;
  setForm: Dispatch<SetStateAction<RouteProfileInput>>;
  providers: ProviderConfigView[];
  routePricing: Partial<Record<AgentRole, RoutePricingHint>>;
  routeCapabilities: Partial<Record<AgentRole, RouteCapabilityHint>>;
  modelsDevOptions: ModelsDevModelOption[];
  modelsDevLoading: boolean;
  modelsForProvider: (providerId: string) => UpstreamModelOption[];
  modelsErrorForProvider: (providerId: string) => string | undefined;
  loadingForProvider: (providerId: string) => boolean;
  error?: string | undefined;
  busy?: boolean | undefined;
  canDelete: boolean;
  pricingLoading: boolean;
  testingAll: boolean;
  testingRole: AgentRole | null;
  routeTestResults: Partial<Record<AgentRole, RoleRouteTestResult>>;
  subagentSettings: SubagentEnabledSettings;
  onClose: () => void;
  onSave: () => void;
  onDelete: () => void;
  onRefreshModelsDev: () => void;
  onTestAll: () => void;
  onTestRole: (role: AgentRole) => void;
  onUpdateRoute: (
    role: AgentRole,
    patch: Partial<RoleRouteConfig>,
    options?: {
      clearThinkingEffort?: boolean;
      clearModelsDevMapping?: boolean;
      clearManualSpec?: boolean;
    },
  ) => void;
  onFetchModels: (provider: ProviderConfigView) => void;
}) {
  const isEditing = Boolean(form.id);
  const title = isEditing ? `编辑 ${form.name.trim() || "路由配置"}` : "新建路由配置";

  return (
    <div className="settings-modal-backdrop" onClick={onClose}>
      <div
        className="settings-modal settings-modal-route-profile"
        role="dialog"
        aria-modal="true"
        aria-labelledby="route-profile-modal-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="settings-modal-header">
          <h2 id="route-profile-modal-title" className="settings-modal-title">
            {title}
          </h2>
          <button type="button" className="mcp-icon-button" onClick={onClose} aria-label="关闭" disabled={busy}>
            <X size={18} />
          </button>
        </header>

        <div className="settings-modal-body">
          <div className="models-route-profile-form">
            <div className="models-route-profile-meta">
              <label className="mcp-field">
                <span className="mcp-field-label">配置名称</span>
                <input
                  className="mcp-field-input"
                  value={form.name}
                  disabled={busy}
                  onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                />
              </label>

            </div>

            <section className="models-route-profile-section">
              <div className="models-route-profile-section-head">
                <h3 className="models-route-profile-section-title">各角色模型</h3>
                <div className="models-route-profile-section-actions">
                  <button
                    type="button"
                    className="models-section-button"
                    disabled={busy || testingAll || testingRole !== null}
                    onClick={onTestAll}
                  >
                    <RefreshCw size={14} className={testingAll ? "model-refresh-spin" : undefined} />
                    测试全部
                  </button>
                  <button
                    type="button"
                    className="models-section-button"
                    disabled={busy || pricingLoading}
                    onClick={onRefreshModelsDev}
                  >
                    刷新 models.dev
                  </button>
                </div>
              </div>

              <ul className="models-route-list models-route-list-modal">
            {AGENT_ROLES.map((role) => {
              const route = form.routes.find((candidate) => candidate.role === role);
              const providerId = route?.providerId ?? providers[0]?.id ?? "";
              const routeModels = modelsForProvider(providerId);
              const routeLoading = loadingForProvider(providerId);
              const routeError = modelsErrorForProvider(providerId);
              const pricing = routePricing[role];
              const capability = routeCapabilities[role];
              const effortDisabled =
                capability?.capabilitiesResolved === true && capability.supportsReasoning === false;
              const needsManualSpec =
                Boolean(route?.modelId) &&
                (!pricing?.pricingResolved || !capability?.contextLimitResolved);
              const roleTest = routeTestResults[role];
              const roleTesting = testingRole === role;
              const routeTestBusy = testingAll || testingRole !== null;
              const canTestRole = Boolean(providerId.trim() && route?.modelId.trim());
              const subagentOff =
                role !== "planner" &&
                SUBAGENT_ROLES.includes(role as SubagentRole) &&
                !subagentSettings[role as SubagentRole];

              return (
                <li
                  key={role}
                  className={
                    subagentOff
                      ? "models-route-card models-route-card-modal models-route-card-subagent-off"
                      : "models-route-card models-route-card-modal"
                  }
                >
                  <div className="models-route-card-head">
                    <div className="models-route-card-identity">
                      <span className="models-route-card-title">
                        <span className="models-route-role">{ROLE_LABELS[role]}</span>
                        <span className="models-route-title-sep" aria-hidden>
                          ·
                        </span>
                        <span className="models-route-role-id">{role}</span>
                        <span className="models-route-title-sep" aria-hidden>
                          ·
                        </span>
                        <ApiCompatToggle
                          value={
                            route?.apiCompat ??
                            providers.find((entry) => entry.id === providerId)?.apiCompat ??
                            "anthropic"
                          }
                          disabled={busy || !providerId}
                          onChange={(apiCompat) => onUpdateRoute(role, { apiCompat })}
                        />
                      </span>
                      {subagentOff ? (
                        <span className="models-subagent-off-badge">子代理已关闭</span>
                      ) : null}
                      {roleTest && (
                        <span
                          className={
                            roleTest.ok
                              ? "models-route-test-badge ok"
                              : "models-route-test-badge err"
                          }
                          title={roleTest.ok ? roleTest.reply : roleTest.error}
                        >
                          {roleTest.ok
                            ? `测试通过${roleTest.elapsedMs !== undefined ? ` · ${formatDurationMs(roleTest.elapsedMs)}` : ""}`
                            : "测试失败"}
                        </span>
                      )}
                      <button
                        type="button"
                        className="models-section-button models-route-role-test-button"
                        disabled={busy || routeTestBusy || !canTestRole}
                        title={
                          !canTestRole
                            ? "请先选择 Provider 与模型"
                            : roleTest?.ok
                              ? roleTest.reply
                              : roleTest?.error
                        }
                        onClick={() => onTestRole(role)}
                      >
                        <RefreshCw size={12} className={roleTesting ? "model-refresh-spin" : undefined} />
                        测试
                      </button>
                    </div>
                    <div className="models-route-card-meta">
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
                      <div className="models-route-capability-badges">
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
                        ) : !route?.modelsDevMapping ? (
                          <span
                            className="models-route-capability-badge models-route-capability-badge-unresolved"
                            title="未匹配 models.dev"
                          >
                            能力 ?
                          </span>
                        ) : null}
                          {route?.modelsDevMapping && (
                            <span className="models-route-capability-badge" title={capability?.modelsDevLabel}>
                              手动映射
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
                          ) : route?.manualSpec?.contextTokens ? (
                            <span
                              className="models-route-capability-badge"
                              title={`手动填写上下文 ${route.manualSpec.contextTokens.toLocaleString()} tokens`}
                            >
                              上下文 {formatContextLimit(route.manualSpec.contextTokens)}
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
                        {route?.manualSpec?.inputPerM !== undefined &&
                          route.manualSpec.outputPerM !== undefined && (
                            <span className="models-route-capability-badge" title="手动填写参考单价">
                              手动单价
                            </span>
                          )}
                      </div>
                    </div>
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
                          const provider = providers.find((entry) => entry.id === nextProviderId);
                          onUpdateRoute(role, {
                            providerId: nextProviderId,
                            modelId: route?.modelId || provider?.defaultModel || "",
                            ...(provider?.apiCompat && { apiCompat: provider.apiCompat }),
                          });
                          if (provider) {
                            onFetchModels(provider);
                          }
                        }}
                      >
                        {providers.map((provider) => (
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
                          const provider = providers.find((entry) => entry.id === providerId);
                          if (provider) {
                            onFetchModels(provider);
                          }
                        }}
                        onChange={(modelId) => onUpdateRoute(role, { modelId })}
                      />
                    </div>
                    <label className="mcp-field models-route-field models-route-field-thinking">
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
                            if (value === "") {
                              onUpdateRoute(role, {}, { clearThinkingEffort: true });
                              return;
                            }
                            onUpdateRoute(role, { thinkingEffort: value as ThinkingEffort });
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
                        {capability && !capability.capabilitiesResolved && !route?.modelsDevMapping && (
                          <span className="models-route-field-hint">未匹配 models.dev，请自行确认</span>
                        )}
                    </label>
                    <div className="mcp-field models-route-field models-route-field-mapping">
                      <span className="mcp-field-label">models.dev 映射</span>
                      <ModelsDevModelSelectField
                        value={route?.modelsDevMapping}
                        options={modelsDevOptions}
                        loading={modelsDevLoading || pricingLoading}
                        disabled={busy}
                        autoResolved={
                          route?.modelsDevMapping
                            ? true
                            : capability?.capabilitiesResolved || pricing?.pricingResolved
                        }
                        autoResolvedMapping={capability?.resolvedModelsDevMapping}
                        autoResolvedLabel={capability?.resolvedModelsDevLabel}
                        onChange={(mapping) => {
                          if (mapping) {
                            onUpdateRoute(role, { modelsDevMapping: mapping });
                            return;
                          }
                          onUpdateRoute(role, {}, { clearModelsDevMapping: true });
                        }}
                      />
                    </div>
                    {(needsManualSpec || route?.manualSpec) && (
                      <RouteManualSpecFields
                        spec={route?.manualSpec}
                        disabled={busy}
                        onChange={(manualSpec) => onUpdateRoute(role, { manualSpec })}
                        onClear={() => onUpdateRoute(role, {}, { clearManualSpec: true })}
                      />
                    )}
                    {roleTest && !roleTest.ok && roleTest.error && (
                      <p className="models-route-test-error">{roleTest.error}</p>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
            </section>

            {error && <p className="settings-form-error">{error}</p>}
          </div>
        </div>

        <footer className="settings-modal-footer settings-modal-footer-split">
          {isEditing ? (
            <button
              type="button"
              className="mcp-uninstall-button"
              onClick={onDelete}
              disabled={busy || !canDelete}
              title={canDelete ? undefined : "至少保留一套子代理编排配置"}
            >
              <Trash2 size={16} />
              删除
            </button>
          ) : (
            <span />
          )}
          <div className="settings-modal-footer-actions">
            <button type="button" className="settings-modal-cancel" onClick={onClose} disabled={busy}>
              取消
            </button>
            <button type="button" className="mcp-save-button" disabled={busy} onClick={onSave}>
              保存
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

function ProviderEditorModal({
  form,
  setForm,
  models,
  modelsLoading,
  modelsError,
  error,
  testing,
  busy,
  canDelete,
  onClose,
  onSave,
  onDelete,
  onRefreshModels,
  onTest,
}: {
  form: ProviderConfigInput;
  setForm: Dispatch<SetStateAction<ProviderConfigInput>>;
  models: UpstreamModelOption[];
  modelsLoading: boolean;
  modelsError?: string | undefined;
  error?: string | undefined;
  testing?: boolean | undefined;
  busy?: boolean | undefined;
  canDelete: boolean;
  onClose: () => void;
  onSave: () => void;
  onDelete: () => void;
  onRefreshModels: () => void;
  onTest: () => void;
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
              placeholder="https://api.deepseek.com"
              onChange={(event) => setForm((current) => ({ ...current, baseUrl: event.target.value }))}
            />
            <span className="mcp-field-hint">
              服务根地址，可含路径（如 https://opencode.ai/zen → GET …/zen/v1/models）
            </span>
          </label>

          <div className="mcp-field models-provider-endpoint-row">
            <span className="mcp-field-label">请求端点</span>
            <div className="models-provider-endpoint-inline">
              <ApiCompatToggle
                value={form.apiCompat ?? "anthropic"}
                onChange={(apiCompat) => setForm((current) => ({ ...current, apiCompat }))}
                disabled={busy}
              />
              <span className="models-route-title-sep" aria-hidden>
                ·
              </span>
              <input
                className="mcp-field-input models-provider-request-path-input"
                value={form.requestPath ?? ""}
                placeholder={isOpenAICompat(form.apiCompat ?? "anthropic") ? "/zen" : "/anthropic"}
                disabled={busy}
                onChange={(event) =>
                  setForm((current) => ({ ...current, requestPath: event.target.value }))
                }
              />
            </div>
            <span className="mcp-field-hint">
              {isOpenAICompat(form.apiCompat ?? "anthropic")
                ? "OpenAI 网关的服务路径前缀（如 /zen）；/anthropic 仅用于 Anthropic Messages，OpenAI 模式会自动忽略"
                : "Anthropic Messages 路径前缀，留空表示根路径"}
              {" · "}
              {UPSTREAM_API_COMPAT_OPTIONS.find((o) => o.value === (form.apiCompat ?? "anthropic"))?.hint}
            </span>
          </div>

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

          <div className="settings-editor-actions settings-form-actions">
            <button
              type="button"
              className="settings-secondary-button"
              disabled={busy || testing || !form.baseUrl.trim() || !form.defaultModel.trim()}
              onClick={onTest}
            >
              <RefreshCw size={16} className={testing ? "model-refresh-spin" : undefined} />
              测试连接
            </button>
          </div>

          {error && <p className="settings-form-error">{error}</p>}
        </div>

        <footer className="settings-modal-footer settings-modal-footer-split">
          {isEditing ? (
            <button
              type="button"
              className="mcp-uninstall-button"
              onClick={onDelete}
              disabled={busy || !canDelete}
              title={canDelete ? undefined : "至少保留一个 Provider"}
            >
              <Trash2 size={16} />
              删除
            </button>
          ) : (
            <span />
          )}
          <div className="settings-modal-footer-actions">
            <button type="button" className="settings-modal-cancel" onClick={onClose} disabled={busy}>
              取消
            </button>
            <button type="button" className="mcp-save-button" disabled={busy} onClick={onSave}>
              保存
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

function RouteManualSpecFields({
  spec,
  disabled,
  onChange,
  onClear,
}: {
  spec?: RouteManualSpec | undefined;
  disabled?: boolean | undefined;
  onChange: (spec: RouteManualSpec) => void;
  onClear: () => void;
}) {
  const hasValues =
    spec?.contextTokens !== undefined ||
    spec?.inputPerM !== undefined ||
    spec?.outputPerM !== undefined ||
    spec?.cacheReadPerM !== undefined ||
    spec?.cacheWritePerM !== undefined;

  function patchManual(partial: { [K in keyof RouteManualSpec]?: RouteManualSpec[K] | undefined }) {
    const next: { [K in keyof RouteManualSpec]?: RouteManualSpec[K] | undefined } = { ...spec, ...partial };
    for (const key of Object.keys(next) as (keyof RouteManualSpec)[]) {
      if (next[key] === undefined) {
        delete next[key];
      }
    }
    onChange(next as RouteManualSpec);
  }

  function parseOptionalNumber(raw: string): number | undefined {
    const trimmed = raw.trim();
    if (!trimmed) {
      return undefined;
    }
    const value = Number(trimmed);
    return Number.isFinite(value) && value > 0 ? value : undefined;
  }

  return (
    <div className="mcp-field models-route-field models-route-manual-spec">
      <div className="model-field-head">
        <span className="mcp-field-label">手动规格（models.dev 未匹配）</span>
        {hasValues && (
          <button type="button" className="model-inline-refresh" disabled={disabled} onClick={onClear}>
            清除
          </button>
        )}
      </div>
      <p className="models-route-field-hint">
        新模型未收录时可填写上下文 token 数与每百万 token 单价（USD），用于费用与上下文估算。
      </p>
      <div className="models-route-manual-spec-grid">
        <label className="mcp-field models-route-manual-field">
          <span className="mcp-field-label">上下文 tokens</span>
          <input
            className="mcp-field-input"
            type="number"
            min={1}
            step={1}
            disabled={disabled}
            value={spec?.contextTokens ?? ""}
            placeholder="如 200000"
            onChange={(event) => patchManual({ contextTokens: parseOptionalNumber(event.target.value) })}
          />
        </label>
        <label className="mcp-field models-route-manual-field">
          <span className="mcp-field-label">输入 $/M</span>
          <input
            className="mcp-field-input"
            type="number"
            min={0}
            step={0.01}
            disabled={disabled}
            value={spec?.inputPerM ?? ""}
            placeholder="如 3"
            onChange={(event) => patchManual({ inputPerM: parseOptionalNumber(event.target.value) })}
          />
        </label>
        <label className="mcp-field models-route-manual-field">
          <span className="mcp-field-label">输出 $/M</span>
          <input
            className="mcp-field-input"
            type="number"
            min={0}
            step={0.01}
            disabled={disabled}
            value={spec?.outputPerM ?? ""}
            placeholder="如 15"
            onChange={(event) => patchManual({ outputPerM: parseOptionalNumber(event.target.value) })}
          />
        </label>
        <label className="mcp-field models-route-manual-field">
          <span className="mcp-field-label">缓存读 $/M</span>
          <input
            className="mcp-field-input"
            type="number"
            min={0}
            step={0.01}
            disabled={disabled}
            value={spec?.cacheReadPerM ?? ""}
            placeholder="可选"
            onChange={(event) => patchManual({ cacheReadPerM: parseOptionalNumber(event.target.value) })}
          />
        </label>
        <label className="mcp-field models-route-manual-field">
          <span className="mcp-field-label">缓存写 $/M</span>
          <input
            className="mcp-field-input"
            type="number"
            min={0}
            step={0.01}
            disabled={disabled}
            value={spec?.cacheWritePerM ?? ""}
            placeholder="可选"
            onChange={(event) => patchManual({ cacheWritePerM: parseOptionalNumber(event.target.value) })}
          />
        </label>
      </div>
    </div>
  );
}

function RouteProfilePreview({ profile }: { profile: RouteProfileView }) {
  return (
    <div className="models-route-profile-preview">
      {AGENT_ROLES.map((role) => {
        const route = profile.routes.find((candidate) => candidate.role === role);
        const modelId = route?.modelId.trim();
        return (
          <div key={role} className="models-route-profile-preview-item">
            <span className="models-route-profile-preview-role">{ROLE_LABELS[role]}</span>
            <span className="models-route-profile-preview-model" title={modelId || "未配置"}>
              {modelId ? formatModelPreview(modelId) : "—"}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function formatModelPreview(modelId: string): string {
  const normalized = modelId.includes("/") ? (modelId.split("/").pop() ?? modelId) : modelId;
  if (normalized.length <= 22) {
    return normalized;
  }
  return `${normalized.slice(0, 10)}…${normalized.slice(-10)}`;
}

function providerToForm(provider?: ProviderConfigView): ProviderConfigInput {
  const form: ProviderConfigInput = {
    name: provider?.name ?? "Anthropic compatible",
    baseUrl: provider?.baseUrl ?? "https://api.anthropic.com",
    requestPath: provider?.requestPath ?? "",
    apiCompat: provider?.apiCompat ?? "anthropic",
    apiKey: "",
    defaultModel: provider?.defaultModel ?? "sonnet",
    enabled: provider?.enabled ?? true,
  };
  if (provider) {
    form.id = provider.id;
  }
  return form;
}

function createBlankRouteProfileForm(settings?: ModelSettingsSnapshot): RouteProfileInput {
  const defaultProvider = settings?.providers[0];
  return {
    name: "",
    routes: AGENT_ROLES.map((role) => ({
      role,
      providerId: defaultProvider?.id ?? "",
      modelId: defaultProvider?.defaultModel ?? "",
      apiCompat: defaultProvider?.apiCompat ?? "anthropic",
    })),
  };
}

function routeProfileToForm(profile: RouteProfileView): RouteProfileInput {
  return {
    id: profile.id,
    name: profile.name,
    routes: profile.routes.map((route) => ({ ...route })),
  };
}
