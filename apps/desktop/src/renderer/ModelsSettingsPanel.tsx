import { formatCostUsd, formatRatePerMillion } from "@eco/runtime";
import {
  ArrowUp,
  Copy,
  Download,
  Eye,
  History,
  Image,
  LinkIcon,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Settings2,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import {
  type Dispatch,
  type DragEvent,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  type BuiltInPresetDefinition,
  buildOrchestrationProfileFromPreset,
  createBuiltInPresetCatalog,
  createUserPresetProfileId,
  createUserPresetProfileName,
} from "../shared/agent-orchestration";
import {
  type BuiltInPresetEvalScenario,
  createBuiltInPresetEvalScenarios,
  type PresetEvalValidationResult,
  validateBuiltInPresetEvalSuite,
} from "../shared/agent-preset-evals";
import { isOpenAICompat, UPSTREAM_API_COMPAT_OPTIONS } from "../shared/api-compat";
import type {
  AgentProfilePerformanceSnapshot,
  AgentTemplate,
  McpServerConfigView,
  ModelsDevModelOption,
  ModelsDevMapping,
  ModelRef,
  ModelSettingsSnapshot,
  OrchestrationProfile,
  OrchestrationProfileVersionView,
  ProviderConfigInput,
  ProviderConfigView,
  ProxyBridgeSettingsSnapshot,
  RouteCapabilityHint,
  RoutePricingHint,
  RuntimeRoleRouteConfig,
  SkillsListResult,
  UpstreamApiCompat,
} from "../shared/ipc";
import { ROUTE_TEST_THINKING_EFFORT, type UpstreamModelOption } from "../shared/models";
import { runtimeRoleRoutesFromAgentProfile } from "../shared/thread-runtime-config";
import { ApiCompatToggle } from "./ApiCompatToggle";
import { AppMessage, type AppMessageKind, formatDurationMs } from "./AppMessage";
import {
  type AgentProfileAgentFormState,
  type AgentProfileFormState,
  agentProfileToForm,
  buildOrchestrationProfileFromForm,
  canEditStoredAgentProfile,
  createBlankAgentProfileForm,
  createCopiedAgentProfileForm,
  createProfileAgentFormFromTemplate,
} from "./agent-profile-form";
import {
  type AgentProfileSummary,
  buildAgentProfileSummary,
  formatAgentDomainLabel,
  listSelectableAgentProfileSummaries,
} from "./agent-profile-summary";
import {
  type AgentTemplateCapabilityOption,
  buildAgentTemplateCapabilityOptions,
  parseList,
  toggleAgentTemplateListValue,
  toggleAgentTemplateToolSelection,
} from "./agent-template-form";
import { ModelSelectField } from "./ModelSelectField";
import { ModelsDevModelSelectField } from "./ModelsDevModelSelectField";
import { ProxyBridgeSettingsSection } from "./ProxyBridgeSettingsSection";
import { buildPresetTemplateImportPlan } from "./preset-import";
import { SubagentSettingsSection } from "./SubagentSettingsSection";

export type ModelsSettingsTab =
  | "subagents"
  | "routes"
  | "providers"
  | "proxyBridge"
  | "presets"
  | "evaluation";

const MODELS_TAB_ITEMS: Array<{ id: ModelsSettingsTab; label: string }> = [
  { id: "subagents", label: "Agent Library" },
  { id: "routes", label: "Agent Profile" },
  { id: "presets", label: "场景预设" },
  { id: "evaluation", label: "效果评测" },
];

const PROVIDER_SETTINGS_TAB_ITEMS: Array<{ id: ModelsSettingsTab; label: string }> = [
  { id: "providers", label: "Provider" },
  { id: "proxyBridge", label: "代理桥" },
];

type AgentProfileEditorMode = "create" | "edit" | "copy";

interface ModelsSettingsPanelProps {
  settings: ModelSettingsSnapshot;
  proxyBridgeSettings: ProxyBridgeSettingsSnapshot;
  mcpServers?: McpServerConfigView[] | undefined;
  skillsSnapshot?: SkillsListResult | undefined;
  proxyBridgeSettingsSaving?: boolean | undefined;
  busy?: boolean | undefined;
  initialTab?: ModelsSettingsTab | undefined;
  mode?: "agentBuilder" | "providerSettings" | undefined;
  onSettingsChange: (settings: ModelSettingsSnapshot) => void;
  onProxyBridgeSettingsChange: (settings: ProxyBridgeSettingsSnapshot) => void;
  onSavingChange?: ((saving: boolean) => void) | undefined;
}

interface ModelsCacheEntry {
  models: UpstreamModelOption[];
  error?: string | undefined;
}

export function ModelsSettingsPanel({
  settings,
  proxyBridgeSettings,
  mcpServers = [],
  skillsSnapshot,
  proxyBridgeSettingsSaving,
  busy,
  initialTab = "subagents",
  mode = "agentBuilder",
  onSettingsChange,
  onProxyBridgeSettingsChange,
  onSavingChange,
}: ModelsSettingsPanelProps) {
  const resolvedInitialTab =
    mode === "providerSettings"
      ? initialTab === "proxyBridge"
        ? "proxyBridge"
        : "providers"
      : initialTab === "providers" || initialTab === "proxyBridge"
        ? "subagents"
        : initialTab;
  const [activeTab, setActiveTab] = useState<ModelsSettingsTab>(resolvedInitialTab);
  const [providerModalOpen, setProviderModalOpen] = useState(false);
  const [providerForm, setProviderForm] = useState<ProviderConfigInput>(() => providerToForm());
  const [agentProfileModalOpen, setAgentProfileModalOpen] = useState(false);
  const [agentProfileForm, setAgentProfileForm] = useState<AgentProfileFormState>(() =>
    createBlankAgentProfileForm(),
  );
  const [agentProfileVersionModal, setAgentProfileVersionModal] = useState<{
    profile: OrchestrationProfile;
    versions: OrchestrationProfileVersionView[];
    error?: string | undefined;
  }>();
  const [editingAgentProfileId, setEditingAgentProfileId] = useState<string>();
  const [agentProfileEditorMode, setAgentProfileEditorMode] = useState<AgentProfileEditorMode>("create");
  const [agentProfileModalError, setAgentProfileModalError] = useState<string>();
  const [modelsCache, setModelsCache] = useState<Record<string, ModelsCacheEntry>>({});
  const [loadingProviderId, setLoadingProviderId] = useState<string | null>(null);
  const [panelError, setPanelError] = useState<string>();
  const [modalError, setModalError] = useState<string>();
  const [testingProviderKey, setTestingProviderKey] = useState<string | null>(null);
  const [testingAgentProfileId, setTestingAgentProfileId] = useState<string | null>(null);
  const [providerTestMessage, setProviderTestMessage] = useState<{
    kind: AppMessageKind;
    message: string;
  }>();
  const [agentProfileTestMessage, setAgentProfileTestMessage] = useState<{
    kind: AppMessageKind;
    message: string;
  }>();
  const [presetProfileMessage, setPresetProfileMessage] = useState<{
    kind: AppMessageKind;
    message: string;
  }>();
  const [auditExportMessage, setAuditExportMessage] = useState<{
    kind: AppMessageKind;
    message: string;
  }>();
  const [modelsDevOptions, setModelsDevOptions] = useState<ModelsDevModelOption[]>([]);
  const [modelsDevLoading, setModelsDevLoading] = useState(false);
  const [capabilityHints, setCapabilityHints] = useState<Record<string, RouteCapabilityHint>>({});
  const [pricingHints, setPricingHints] = useState<Record<string, RoutePricingHint>>({});
  const [profileArchiveMessage, setProfileArchiveMessage] = useState<{
    kind: AppMessageKind;
    message: string;
  }>();
  const [profilePerformance, setProfilePerformance] = useState<AgentProfilePerformanceSnapshot[]>([]);
  const [profilePerformanceLoading, setProfilePerformanceLoading] = useState(false);
  const [profilePerformanceError, setProfilePerformanceError] = useState<string>();
  const [auditExportBusy, setAuditExportBusy] = useState(false);
  const [profileArchiveBusy, setProfileArchiveBusy] = useState(false);
  const [agentProfileVersionBusy, setAgentProfileVersionBusy] = useState(false);
  const [presetProfileBusyId, setPresetProfileBusyId] = useState<string | null>(null);

  useEffect(() => {
    setActiveTab(resolvedInitialTab);
  }, [resolvedInitialTab]);

  const modalProviderId = providerForm.id ?? "__draft__";
  const modalCache = modelsCache[modalProviderId];

  const refreshSettings = useCallback(async () => {
    if (!window.eco) {
      return;
    }
    const snapshot = await window.eco.getModelSettings();
    onSettingsChange(snapshot);
  }, [onSettingsChange]);

  const refreshProfilePerformance = useCallback(async () => {
    if (!window.eco?.listAgentProfilePerformance) {
      return;
    }
    setProfilePerformanceLoading(true);
    setProfilePerformanceError(undefined);
    try {
      const snapshot = await window.eco.listAgentProfilePerformance();
      setProfilePerformance(snapshot);
    } catch (caught) {
      setProfilePerformanceError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setProfilePerformanceLoading(false);
    }
  }, []);

  const exportAgentAudit = useCallback(async () => {
    if (!window.eco?.exportAgentAudit) {
      setAuditExportMessage({ kind: "error", message: "审计导出接口不可用。" });
      return;
    }
    setAuditExportBusy(true);
    setAuditExportMessage(undefined);
    try {
      const result = await window.eco.exportAgentAudit();
      if (result.canceled) {
        return;
      }
      setAuditExportMessage({
        kind: "success",
        message: `已导出 ${result.exportedThreads} 个线程的 Agent 审计日志${result.path ? `：${result.path}` : ""}`,
      });
    } catch (caught) {
      setAuditExportMessage({
        kind: "error",
        message: caught instanceof Error ? caught.message : String(caught),
      });
    } finally {
      setAuditExportBusy(false);
    }
  }, []);

  const exportAgentProfiles = useCallback(async (profileIds?: string[]) => {
    if (!window.eco?.exportOrchestrationProfiles) {
      setProfileArchiveMessage({ kind: "error", message: "Agent Profile 导出接口不可用。" });
      return;
    }
    setProfileArchiveBusy(true);
    setProfileArchiveMessage(undefined);
    try {
      const result = await window.eco.exportOrchestrationProfiles(profileIds ? { profileIds } : undefined);
      if (result.canceled) {
        return;
      }
      setProfileArchiveMessage({
        kind: "success",
        message: `已导出 ${result.exported} 个 Agent Profile${result.path ? `：${result.path}` : ""}`,
      });
    } catch (caught) {
      setProfileArchiveMessage({
        kind: "error",
        message: caught instanceof Error ? caught.message : String(caught),
      });
    } finally {
      setProfileArchiveBusy(false);
    }
  }, []);

  const importAgentProfiles = useCallback(async () => {
    if (!window.eco?.importOrchestrationProfiles) {
      setProfileArchiveMessage({ kind: "error", message: "Agent Profile 导入接口不可用。" });
      return;
    }
    setProfileArchiveBusy(true);
    setProfileArchiveMessage(undefined);
    onSavingChange?.(true);
    try {
      const result = await window.eco.importOrchestrationProfiles();
      if (result.canceled) {
        return;
      }
      await refreshSettings();
      setProfileArchiveMessage({
        kind: "success",
        message:
          result.errors.length > 0
            ? `已导入 ${result.imported} 个 Agent Profile，${result.errors.length} 个失败`
            : `已导入 ${result.imported} 个 Agent Profile`,
      });
    } catch (caught) {
      setProfileArchiveMessage({
        kind: "error",
        message: caught instanceof Error ? caught.message : String(caught),
      });
    } finally {
      setProfileArchiveBusy(false);
      onSavingChange?.(false);
    }
  }, [onSavingChange, refreshSettings]);

  const copyPresetToProfile = useCallback(
    async (preset: BuiltInPresetDefinition) => {
      if (!window.eco?.saveAgentTemplate || !window.eco?.saveOrchestrationProfile) {
        setPresetProfileMessage({ kind: "error", message: "场景预设导入接口不可用。" });
        return;
      }
      const provider = selectPresetDefaultProvider(settings.providers);
      if (!provider) {
        setPresetProfileMessage({
          kind: "error",
          message: "请先在 Provider 设置中配置至少一个启用且带默认模型的 Provider。",
        });
        return;
      }
      setPresetProfileBusyId(preset.id);
      setPresetProfileMessage(undefined);
      onSavingChange?.(true);
      try {
        const importPlan = buildPresetTemplateImportPlan(preset, settings.agentTemplates);
        const savedTemplates: AgentTemplate[] = [];
        for (const template of importPlan.templatesToSave) {
          savedTemplates.push(await window.eco.saveAgentTemplate(template));
        }
        const profile = buildOrchestrationProfileFromPreset(importPlan.presetForProfile, {
          id: createUserPresetProfileId(
            preset.id,
            settings.orchestrationProfiles.map((profile) => profile.id),
          ),
          name: createUserPresetProfileName(
            preset.name,
            settings.orchestrationProfiles.map((profile) => profile.name),
          ),
          modelRef: modelRefFromProvider(provider),
          templates:
            savedTemplates.length > 0
              ? [
                  ...settings.agentTemplates.filter(
                    (template) => !savedTemplates.some((saved) => saved.id === template.id),
                  ),
                  ...savedTemplates,
                ]
              : importPlan.templatesForProfile,
        });
        await window.eco.saveOrchestrationProfile(profile);
        await refreshSettings();
        setActiveTab("routes");
        const importedTemplateCount = savedTemplates.length;
        const templateMessage =
          importedTemplateCount > 0
            ? `已导入 ${importedTemplateCount} 个子代理模板`
            : "已复用现有子代理模板副本";
        setPresetProfileMessage({
          kind: "success",
          message: `${templateMessage}并创建 Agent Profile「${profile.name}」，默认使用 ${provider.name} / ${provider.defaultModel}。`,
        });
      } catch (caught) {
        setPresetProfileMessage({
          kind: "error",
          message: caught instanceof Error ? caught.message : String(caught),
        });
      } finally {
        setPresetProfileBusyId(null);
        onSavingChange?.(false);
      }
    },
    [settings, refreshSettings, onSavingChange],
  );

  useEffect(() => {
    if (activeTab !== "routes") {
      return;
    }
    void refreshProfilePerformance();
  }, [activeTab, refreshProfilePerformance]);

  useEffect(() => {
    if (!window.eco?.listModelsDevModels) {
      return;
    }
    if (modelsDevOptions.length > 0 || modelsDevLoading) {
      return;
    }
    setModelsDevLoading(true);
    window.eco
      .listModelsDevModels()
      .then((options) => setModelsDevOptions(options))
      .catch(() => {})
      .finally(() => setModelsDevLoading(false));
  }, [modelsDevOptions.length, modelsDevLoading]);

  const lookupNodeCapabilities = useCallback(
    async (nodes: Array<{ key: string; providerId: string; modelId: string; apiCompat?: string }>) => {
      if (!window.eco?.getRouteCapabilities || nodes.length === 0) {
        return;
      }
      try {
        const routes = buildRouteLookupPayload(nodes);
        if (routes.length === 0) {
          return;
        }
        const hints = await window.eco.getRouteCapabilities(routes);
        setCapabilityHints((prev) => {
          const next = { ...prev };
          for (const hint of hints) {
            next[hint.role] = hint;
          }
          return next;
        });
      } catch {
        // Silently ignore capability lookup failures
      }
    },
    [],
  );

  const lookupNodePricing = useCallback(
    async (nodes: Array<{ key: string; providerId: string; modelId: string; apiCompat?: string }>) => {
      if (!window.eco?.getRoutePricing || nodes.length === 0) {
        return;
      }
      try {
        const routes = buildRouteLookupPayload(nodes);
        if (routes.length === 0) {
          return;
        }
        const hints = await window.eco.getRoutePricing(routes);
        setPricingHints((prev) => {
          const next = { ...prev };
          for (const hint of hints) {
            next[hint.role] = hint;
          }
          return next;
        });
      } catch {
        // Silently ignore
      }
    },
    [],
  );

  const fetchModels = useCallback(async (target: ProviderConfigInput, options?: { silent?: boolean }) => {
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
  }, []);

  useEffect(() => {
    if (!providerModalOpen || !providerForm.id) {
      return;
    }
    const cached = modelsCache[providerForm.id];
    if (cached?.models.length || cached?.error) {
      return;
    }
    void fetchModels(providerForm, { silent: true });
  }, [providerModalOpen, providerForm, modelsCache, fetchModels]);

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

  function profileFormOptions() {
    return {
      existingIds: settings.orchestrationProfiles.map((profile) => profile.id),
      existingNames: settings.orchestrationProfiles.map((profile) => profile.name),
      providers: settings.providers,
      templates: settings.agentTemplates,
    };
  }

  function openCreateAgentProfile() {
    setPanelError(undefined);
    setAgentProfileModalError(undefined);
    setEditingAgentProfileId(undefined);
    setAgentProfileEditorMode("create");
    setAgentProfileForm(createBlankAgentProfileForm(profileFormOptions()));
    setAgentProfileModalOpen(true);
  }

  function openEditAgentProfile(profile: OrchestrationProfile) {
    setPanelError(undefined);
    setAgentProfileModalError(undefined);
    if (!canEditStoredAgentProfile(profile)) {
      openCopyAgentProfile(profile);
      return;
    }
    setEditingAgentProfileId(profile.id);
    setAgentProfileEditorMode("edit");
    setAgentProfileForm(agentProfileToForm(profile));
    setAgentProfileModalOpen(true);
  }

  function openCopyAgentProfile(profile: OrchestrationProfile) {
    setPanelError(undefined);
    setAgentProfileModalError(undefined);
    setEditingAgentProfileId(undefined);
    setAgentProfileEditorMode("copy");
    setAgentProfileForm(createCopiedAgentProfileForm(profile, profileFormOptions()));
    setAgentProfileModalOpen(true);
  }

  function closeAgentProfileModal() {
    setAgentProfileModalOpen(false);
    setAgentProfileModalError(undefined);
    setEditingAgentProfileId(undefined);
    setAgentProfileEditorMode("create");
    setAgentProfileForm(createBlankAgentProfileForm(profileFormOptions()));
  }

  async function openAgentProfileVersions(profile: OrchestrationProfile) {
    if (!window.eco?.listOrchestrationProfileVersions) {
      setProfileArchiveMessage({ kind: "error", message: "Agent Profile 版本接口不可用。" });
      return;
    }
    setAgentProfileVersionBusy(true);
    setProfileArchiveMessage(undefined);
    try {
      const versions = await window.eco.listOrchestrationProfileVersions(profile.id);
      setAgentProfileVersionModal({ profile, versions });
    } catch (caught) {
      setProfileArchiveMessage({
        kind: "error",
        message: caught instanceof Error ? caught.message : String(caught),
      });
    } finally {
      setAgentProfileVersionBusy(false);
    }
  }

  async function restoreAgentProfileVersion(profileId: string, version: number) {
    if (
      !window.eco?.restoreOrchestrationProfileVersion ||
      !window.eco?.listOrchestrationProfileVersions ||
      !agentProfileVersionModal
    ) {
      return;
    }
    setAgentProfileVersionBusy(true);
    onSavingChange?.(true);
    try {
      const restored = await window.eco.restoreOrchestrationProfileVersion({ profileId, version });
      await refreshSettings();
      const versions = await window.eco.listOrchestrationProfileVersions(profileId);
      setAgentProfileVersionModal({ profile: restored, versions });
      setProfileArchiveMessage({
        kind: "success",
        message: `已恢复 Agent Profile「${restored.name}」到 v${version}`,
      });
    } catch (caught) {
      setAgentProfileVersionModal({
        ...agentProfileVersionModal,
        error: caught instanceof Error ? caught.message : String(caught),
      });
    } finally {
      setAgentProfileVersionBusy(false);
      onSavingChange?.(false);
    }
  }

  async function saveAgentProfile() {
    if (!window.eco?.saveOrchestrationProfile) {
      return;
    }
    setAgentProfileModalError(undefined);
    onSavingChange?.(true);
    try {
      const existing = editingAgentProfileId
        ? settings.orchestrationProfiles.find((profile) => profile.id === editingAgentProfileId)
        : undefined;
      const profile = buildOrchestrationProfileFromForm(agentProfileForm, {
        ...(existing && { existing }),
        templates: settings.agentTemplates,
      });
      await window.eco.saveOrchestrationProfile(profile);
      await refreshSettings();
      closeAgentProfileModal();
    } catch (caught) {
      setAgentProfileModalError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      onSavingChange?.(false);
    }
  }

  async function deleteAgentProfile(profile: OrchestrationProfile) {
    if (!window.eco?.deleteOrchestrationProfile || !canEditStoredAgentProfile(profile)) {
      return;
    }
    if (!window.confirm(`确定删除 Agent Profile「${profile.name}」？`)) {
      return;
    }
    onSavingChange?.(true);
    try {
      await window.eco.deleteOrchestrationProfile(profile.id);
      await refreshSettings();
    } catch (caught) {
      setPanelError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      onSavingChange?.(false);
    }
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
    if (
      !window.confirm(`确定删除 Provider「${providerName}」？引用它的 Agent Profile 将改用其他 Provider。`)
    ) {
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

  async function testAgentProfile(profile: OrchestrationProfile) {
    if (!window.eco?.testRouteProfile) {
      return;
    }
    const routes = runtimeRoleRoutesFromAgentProfile(profile);
    const displayNames = new Map<string, string>([
      ["planner", profile.mainAgent.name || "主 Agent"],
      ["explore", "Explore"],
      ...profile.agents.map((agent) => [agent.agentKey, agent.displayName || agent.agentKey] as const),
    ]);
    setTestingAgentProfileId(profile.id);
    setAgentProfileTestMessage(undefined);

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

      if (result.failed === 0) {
        const uniqueModels = new Set(
          routes
            .filter((route) => route.providerId.trim() && route.modelId.trim())
            .map((route) => `${route.providerId.trim()}:${route.modelId.trim()}:${route.apiCompat ?? ""}`),
        );
        const durations = result.results
          .map((entry) => (entry.elapsedMs !== undefined ? formatDurationMs(entry.elapsedMs) : undefined))
          .filter(Boolean);
        const durationHint = durations.length > 0 ? `，耗时 ${durations[0]}` : "";
        const dedupeHint =
          uniqueModels.size < result.passed
            ? `（${uniqueModels.size} 组 Provider+模型，共 ${result.passed} 个 Agent）`
            : "";
        setAgentProfileTestMessage({
          kind: "success",
          message: `Agent Profile「${profile.name}」全部 ${result.passed} 个 Agent 已通过 /v1/messages 测试${dedupeHint}${durationHint}`,
        });
      } else {
        const failedLabels = result.results
          .filter((entry) => !entry.ok)
          .map((entry) => `${displayNames.get(entry.role) ?? entry.role}：${entry.error ?? "失败"}`)
          .join("；");
        setAgentProfileTestMessage({
          kind: "error",
          message: `Agent Profile「${profile.name}」${result.passed}/${result.results.length} 通过。失败：${failedLabels}`,
        });
      }
    } catch (caught) {
      setAgentProfileTestMessage({
        kind: "error",
        message: caught instanceof Error ? caught.message : String(caught),
      });
    } finally {
      setTestingAgentProfileId(null);
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
      showProviderTestMessage("error", caught instanceof Error ? caught.message : String(caught));
    } finally {
      setTestingProviderKey(null);
    }
  }

  const providerOptions = useMemo(() => settings.providers, [settings.providers]);
  const selectableProfileSummaries = useMemo(() => listSelectableAgentProfileSummaries(settings), [settings]);
  const allProfileSummaries = useMemo(
    () => settings.orchestrationProfiles.map((profile) => buildAgentProfileSummary(settings, profile)),
    [settings],
  );
  const presetCatalog = useMemo(() => createBuiltInPresetCatalog(), []);
  const presetEvalScenarios = useMemo(() => createBuiltInPresetEvalScenarios(), []);
  const presetEvalResults = useMemo(
    () => validateBuiltInPresetEvalSuite(presetEvalScenarios),
    [presetEvalScenarios],
  );
  const performanceByProfileKey = useMemo(() => {
    const map = new Map<string, AgentProfilePerformanceSnapshot>();
    for (const performance of profilePerformance) {
      map.set(performance.profileId, performance);
      map.set(performance.selectionId, performance);
    }
    return map;
  }, [profilePerformance]);

  return (
    <>
      {providerTestMessage && (
        <AppMessage
          kind={providerTestMessage.kind}
          message={providerTestMessage.message}
          onDismiss={() => setProviderTestMessage(undefined)}
        />
      )}
      {agentProfileTestMessage && (
        <AppMessage
          kind={agentProfileTestMessage.kind}
          message={agentProfileTestMessage.message}
          onDismiss={() => setAgentProfileTestMessage(undefined)}
        />
      )}
      {presetProfileMessage && (
        <AppMessage
          kind={presetProfileMessage.kind}
          message={presetProfileMessage.message}
          onDismiss={() => setPresetProfileMessage(undefined)}
        />
      )}
      {auditExportMessage && (
        <AppMessage
          kind={auditExportMessage.kind}
          message={auditExportMessage.message}
          onDismiss={() => setAuditExportMessage(undefined)}
        />
      )}
      {profileArchiveMessage && (
        <AppMessage
          kind={profileArchiveMessage.kind}
          message={profileArchiveMessage.message}
          onDismiss={() => setProfileArchiveMessage(undefined)}
        />
      )}

      <header className="mcp-page-header">
        {mode === "providerSettings" ? (
          <>
            <h1>Provider</h1>
            <p className="mcp-page-desc">管理上游模型服务、API Key、默认模型和本地代理桥。</p>
          </>
        ) : (
          <>
            <h1>Agent Builder</h1>
            <p className="mcp-page-desc">配置 Agent 编排资产与评测。</p>
          </>
        )}
      </header>

      <div
        className="models-settings-tabs"
        role="tablist"
        aria-label={mode === "providerSettings" ? "Provider 设置分类" : "模型设置分类"}
      >
        {(mode === "providerSettings" ? PROVIDER_SETTINGS_TAB_ITEMS : MODELS_TAB_ITEMS).map((tab) => (
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
          <section className="mcp-list-section models-subagent-section">
            <header className="models-section-header">
              <div className="models-section-intro">
                <h2 className="models-section-title">子代理库</h2>
                <p className="models-section-desc">维护可复用子代理模板。</p>
              </div>
            </header>
            <SubagentSettingsSection
              templates={settings.agentTemplates}
              mcpServers={mcpServers}
              skillsSnapshot={skillsSnapshot}
              registryDisabled={busy}
              onRegistryChange={refreshSettings}
              onSavingChange={onSavingChange}
            />
          </section>
        </div>
      )}

      {activeTab === "proxyBridge" && (
        <ProxyBridgeSettingsSection
          settings={proxyBridgeSettings}
          disabled={busy || proxyBridgeSettingsSaving}
          onSave={onProxyBridgeSettingsChange}
        />
      )}

      {activeTab === "providers" && (
        <section className="mcp-list-section">
          <header className="models-section-header">
            <div className="models-section-intro">
              <h2 className="models-section-title">Provider</h2>
              <p className="models-section-desc">
                管理上游模型服务、API Key、默认模型和 API 兼容模式。Agent Profile 里的模型绑定从这里选择。
              </p>
            </div>
          </header>
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
                      <span
                        className={provider.enabled ? "models-provider-badge on" : "models-provider-badge"}
                      >
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
                        title={`配置 ${provider.name}`}
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
      )}

      {activeTab === "routes" && (
        <section className="mcp-list-section models-routes-section">
          <header className="models-section-header">
            <div className="models-section-intro">
              <h2 className="models-section-title">Agent Profile</h2>
              <p className="models-section-desc">组合主 Agent 与子代理模型。</p>
            </div>
          </header>

          <div className="mcp-list-toolbar">
            <span className="mcp-list-toolbar-label">Agent Profile</span>
            <div className="models-route-toolbar-actions">
              <button
                type="button"
                className="models-section-button"
                disabled={busy || profilePerformanceLoading}
                onClick={() => void refreshProfilePerformance()}
              >
                <RefreshCw
                  size={14}
                  className={profilePerformanceLoading ? "model-refresh-spin" : undefined}
                />
                刷新表现
              </button>
              <button
                type="button"
                className="models-section-button"
                disabled={busy || auditExportBusy}
                onClick={() => void exportAgentAudit()}
              >
                <Download size={14} />
                导出审计 JSON
              </button>
              <button
                type="button"
                className="models-section-button"
                disabled={busy || profileArchiveBusy}
                onClick={() => void importAgentProfiles()}
              >
                <ArrowUp size={14} />
                导入 Profile
              </button>
              <button
                type="button"
                className="models-section-button"
                disabled={busy || profileArchiveBusy}
                onClick={() => void exportAgentProfiles()}
              >
                <Download size={14} />
                导出 Profile
              </button>
              <button
                type="button"
                className="mcp-add-button"
                disabled={busy}
                onClick={openCreateAgentProfile}
              >
                <Plus size={16} />
                添加 Agent Profile
              </button>
            </div>
          </div>
          {profilePerformanceError ? (
            <p className="settings-form-error mcp-list-error">{profilePerformanceError}</p>
          ) : null}

          {selectableProfileSummaries.length === 0 ? (
            <p className="mcp-list-empty">尚未添加可运行的 Agent Profile</p>
          ) : (
            <ul className="mcp-server-list">
              {selectableProfileSummaries.map((summary) => {
                const editableProfile = canEditStoredAgentProfile(summary.profile);
                const performance =
                  performanceByProfileKey.get(summary.profile.id) ??
                  (summary.selectionId ? performanceByProfileKey.get(summary.selectionId) : undefined);
                const testingProfile = testingAgentProfileId === summary.profile.id;
                return (
                  <li key={summary.profile.id} className="mcp-server-row models-agent-profile-row">
                    <div className="models-agent-profile-stack">
                      <AgentProfileSummaryBlock summary={summary} />
                      <AgentProfilePerformanceStrip
                        performance={performance}
                        loading={profilePerformanceLoading}
                      />
                    </div>
                    <div className="mcp-server-actions">
                      <button
                        type="button"
                        className="mcp-icon-button"
                        disabled={busy || testingAgentProfileId !== null}
                        onClick={() => void testAgentProfile(summary.profile)}
                        aria-label={`连通性测试：${summary.name}`}
                        title={`连通性测试：${summary.name}`}
                      >
                        {testingProfile ? (
                          <RefreshCw size={18} className="model-refresh-spin" />
                        ) : (
                          <LinkIcon size={18} />
                        )}
                      </button>
                      <button
                        type="button"
                        className="mcp-icon-button"
                        onClick={() => openCopyAgentProfile(summary.profile)}
                        aria-label={`复制 ${summary.name}`}
                        title={`复制 ${summary.name}`}
                        disabled={busy}
                      >
                        <Copy size={18} />
                      </button>
                      <button
                        type="button"
                        className="mcp-icon-button"
                        onClick={() => void exportAgentProfiles([summary.profile.id])}
                        aria-label={`导出 ${summary.name}`}
                        title={`导出 ${summary.name}`}
                        disabled={busy || profileArchiveBusy}
                      >
                        <Download size={18} />
                      </button>
                      <button
                        type="button"
                        className="mcp-icon-button"
                        onClick={() => openEditAgentProfile(summary.profile)}
                        aria-label={editableProfile ? `编辑 ${summary.name}` : `复制 ${summary.name}`}
                        title={editableProfile ? `编辑 ${summary.name}` : `复制 ${summary.name}`}
                        disabled={busy}
                      >
                        <Pencil size={18} />
                      </button>
                      {editableProfile ? (
                        <button
                          type="button"
                          className="mcp-icon-button"
                          onClick={() => void openAgentProfileVersions(summary.profile)}
                          aria-label={`查看 ${summary.name} 版本历史`}
                          title={`查看 ${summary.name} 版本历史`}
                          disabled={busy || agentProfileVersionBusy}
                        >
                          <History size={18} />
                        </button>
                      ) : null}
                      {editableProfile ? (
                        <button
                          type="button"
                          className="mcp-icon-button danger"
                          onClick={() => void deleteAgentProfile(summary.profile)}
                          aria-label={`删除 ${summary.name}`}
                          title={`删除 ${summary.name}`}
                          disabled={busy}
                        >
                          <Trash2 size={18} />
                        </button>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      {activeTab === "presets" && (
        <section className="mcp-list-section models-presets-section">
          <header className="models-section-header">
            <div className="models-section-intro">
              <h2 className="models-section-title">场景预设</h2>
              <p className="models-section-desc">从内置场景快速生成 Profile。</p>
            </div>
          </header>

          <PresetOverview
            presets={presetCatalog}
            templates={settings.agentTemplates}
            profiles={allProfileSummaries}
            busy={busy || Boolean(presetProfileBusyId)}
            copyingPresetId={presetProfileBusyId}
            onCopyPreset={copyPresetToProfile}
          />
        </section>
      )}

      {activeTab === "evaluation" && (
        <section className="mcp-list-section models-evaluation-section">
          <header className="models-section-header">
            <div className="models-section-intro">
              <h2 className="models-section-title">效果评测</h2>
              <p className="models-section-desc">检查预设和 Profile 配置质量。</p>
            </div>
          </header>

          <PresetEvaluationOverview scenarios={presetEvalScenarios} results={presetEvalResults} />
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

      {agentProfileModalOpen && (
        <AgentProfileEditorModal
          form={agentProfileForm}
          setForm={setAgentProfileForm}
          providers={settings.providers}
          templates={settings.agentTemplates}
          mcpServers={mcpServers}
          skillsSnapshot={skillsSnapshot}
          modelsForProvider={modelsForProvider}
          modelsErrorForProvider={modelsErrorForProvider}
          loadingForProvider={loadingForProvider}
          modelsDevOptions={modelsDevOptions}
          modelsDevLoading={modelsDevLoading}
          capabilityHints={capabilityHints}
          onLookupCapabilities={lookupNodeCapabilities}
          pricingHints={pricingHints}
          onLookupPricing={lookupNodePricing}
          error={agentProfileModalError}
          busy={busy}
          mode={agentProfileEditorMode}
          onClose={closeAgentProfileModal}
          onSave={() => void saveAgentProfile()}
          onFetchModels={(provider) => void fetchModels(providerToForm(provider))}
        />
      )}

      {agentProfileVersionModal && (
        <AgentProfileVersionModal
          profile={agentProfileVersionModal.profile}
          versions={agentProfileVersionModal.versions}
          error={agentProfileVersionModal.error}
          busy={busy || agentProfileVersionBusy}
          onClose={() => setAgentProfileVersionModal(undefined)}
          onRestore={(version) =>
            void restoreAgentProfileVersion(agentProfileVersionModal.profile.id, version)
          }
        />
      )}
    </>
  );
}

function AgentProfileVersionModal({
  profile,
  versions,
  error,
  busy,
  onClose,
  onRestore,
}: {
  profile: OrchestrationProfile;
  versions: OrchestrationProfileVersionView[];
  error?: string | undefined;
  busy?: boolean | undefined;
  onClose: () => void;
  onRestore: (version: number) => void;
}) {
  return (
    <div className="settings-modal-backdrop">
      <button
        type="button"
        className="settings-modal-backdrop-close"
        onClick={onClose}
        aria-label="关闭"
        title="关闭"
        disabled={busy}
      />
      <div
        className="settings-modal settings-modal-agent-version"
        role="dialog"
        aria-modal="true"
        aria-labelledby="agent-profile-version-title"
      >
        <header className="settings-modal-header">
          <h2 id="agent-profile-version-title" className="settings-modal-title">
            {profile.name} 版本历史
          </h2>
          <button
            type="button"
            className="mcp-icon-button"
            onClick={onClose}
            aria-label="关闭"
            title="关闭"
            disabled={busy}
          >
            <X size={18} />
          </button>
        </header>
        <div className="settings-modal-body">
          {versions.length === 0 ? (
            <p className="mcp-list-empty">暂无版本记录</p>
          ) : (
            <ul className="models-agent-version-list">
              {versions.map((entry, index) => (
                <li key={`${entry.profileId}-${entry.version}`} className="models-agent-version-row">
                  <div className="models-agent-version-main">
                    <span className="models-route-role">v{entry.version}</span>
                    {index === 0 ? <span className="models-agent-source-badge">当前</span> : null}
                    <span className="models-route-role-id">{formatVersionTime(entry.savedAt)}</span>
                    <p className="models-subagent-card-desc">
                      {formatAgentProfileVersionSummary(entry.profile)}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="models-section-button"
                    disabled={busy || index === 0}
                    onClick={() => onRestore(entry.version)}
                  >
                    <RotateCcw size={14} />
                    恢复
                  </button>
                </li>
              ))}
            </ul>
          )}
          {error && <p className="settings-form-error">{error}</p>}
        </div>
      </div>
    </div>
  );
}

interface AgentProfileToolPolicyFieldValues {
  allowedTools: string;
  disallowedTools: string;
  mcpServers: string;
  mcpTools: string;
  bashCommandAllowlist: string;
  bashCommandDenylist: string;
  filesystemRead: AgentProfileAgentFormState["filesystemRead"];
  filesystemWrite: AgentProfileAgentFormState["filesystemWrite"];
  networkWebSearch: boolean;
  networkWebFetch: boolean;
}

const AGENT_TEMPLATE_DRAG_TYPE = "application/x-eco-agent-template";

type AgentProfileSelectedNode =
  | { kind: "main" }
  | { kind: "builtinExplore" }
  | { kind: "agent"; agentKey: string };

function buildRouteLookupPayload(
  nodes: Array<{ key: string; providerId: string; modelId: string; apiCompat?: string }>,
): RuntimeRoleRouteConfig[] {
  return nodes
    .filter((node) => node.providerId.trim() && node.modelId.trim())
    .map((node) => {
      const apiCompat = node.apiCompat?.trim();
      return {
        role: node.key,
        providerId: node.providerId.trim(),
        modelId: node.modelId.trim(),
        ...(apiCompat ? { apiCompat: apiCompat as UpstreamApiCompat } : {}),
      };
    });
}

function AgentProfileEditorModal({
  form,
  setForm,
  providers,
  templates,
  mcpServers,
  skillsSnapshot,
  modelsForProvider,
  modelsErrorForProvider,
  loadingForProvider,
  modelsDevOptions,
  modelsDevLoading,
  capabilityHints,
  pricingHints,
  onLookupCapabilities,
  onLookupPricing,
  error,
  busy,
  mode,
  onClose,
  onSave,
  onFetchModels,
}: {
  form: AgentProfileFormState;
  setForm: Dispatch<SetStateAction<AgentProfileFormState>>;
  providers: ProviderConfigView[];
  templates: AgentTemplate[];
  mcpServers: McpServerConfigView[];
  skillsSnapshot?: SkillsListResult | undefined;
  modelsForProvider: (providerId: string) => UpstreamModelOption[];
  modelsErrorForProvider: (providerId: string) => string | undefined;
  loadingForProvider: (providerId: string) => boolean;
  modelsDevOptions: readonly ModelsDevModelOption[];
  modelsDevLoading: boolean;
  capabilityHints: Record<string, RouteCapabilityHint>;
  pricingHints: Record<string, RoutePricingHint>;
  onLookupCapabilities: (
    nodes: Array<{ key: string; providerId: string; modelId: string; apiCompat?: string }>,
  ) => Promise<void>;
  onLookupPricing: (
    nodes: Array<{ key: string; providerId: string; modelId: string; apiCompat?: string }>,
  ) => Promise<void>;
  error?: string | undefined;
  busy?: boolean | undefined;
  mode: AgentProfileEditorMode;
  onClose: () => void;
  onSave: () => void;
  onFetchModels: (provider: ProviderConfigView) => void;
}) {
  const modalTitle =
    mode === "edit" ? "编辑 Agent Profile" : mode === "copy" ? "复制为 Agent Profile" : "新建 Agent Profile";
  const modalBadge = mode === "edit" ? "编辑" : mode === "copy" ? "副本" : "新建";
  const modalHint =
    mode === "edit"
      ? "修改当前 Profile 的名称、主 Agent 和子代理节点。"
      : mode === "copy"
        ? "基于现有 Profile 创建一份可编辑副本。"
        : "创建新的 Profile，并选择需要的子代理节点。";
  const saveLabel = mode === "edit" ? "保存修改" : mode === "copy" ? "创建副本" : "创建";
  const activeProvider = providers.find((provider) => provider.id === form.mainProviderId);
  const builtinExploreProvider = providers.find((provider) => provider.id === form.builtinExploreProviderId);
  const selectedTemplateIds = useMemo(
    () => new Set(form.agents.map((agent) => agent.templateId)),
    [form.agents],
  );
  const selectableTemplates = useMemo(
    () => templates.filter((template) => !selectedTemplateIds.has(template.id)),
    [selectedTemplateIds, templates],
  );
  const [selectedNode, setSelectedNode] = useState<AgentProfileSelectedNode | null>(null);
  const selectedAgentKey = selectedNode?.kind === "agent" ? selectedNode.agentKey : undefined;
  const selectedAgentIndex =
    selectedAgentKey !== undefined
      ? form.agents.findIndex((agent) => agent.agentKey === selectedAgentKey)
      : -1;
  const selectedAgent = selectedAgentIndex >= 0 ? form.agents[selectedAgentIndex] : undefined;
  const selectedAgentTemplate = selectedAgent
    ? templates.find((template) => template.id === selectedAgent.templateId)
    : undefined;

  useEffect(() => {
    if (selectedAgentKey !== undefined && selectedAgentIndex === -1) {
      setSelectedNode(null);
    }
  }, [selectedAgentIndex, selectedAgentKey]);

  useEffect(() => {
    const nodes: Array<{ key: string; providerId: string; modelId: string; apiCompat?: string }> = [
      {
        key: "main",
        providerId: form.mainProviderId,
        modelId: form.mainModelId,
        ...(form.mainApiCompat ? { apiCompat: form.mainApiCompat } : {}),
      },
      {
        key: "explore",
        providerId: form.builtinExploreProviderId,
        modelId: form.builtinExploreModelId,
      },
      ...form.agents.map((agent) => ({
        key: agent.agentKey,
        providerId: agent.providerId,
        modelId: agent.modelId,
      })),
    ];
    void onLookupCapabilities(nodes);
    void onLookupPricing(nodes);
  }, [
    form.mainProviderId,
    form.mainModelId,
    form.mainApiCompat,
    form.builtinExploreProviderId,
    form.builtinExploreModelId,
    form.agents,
    onLookupCapabilities,
    onLookupPricing,
  ]);

  function patch(patch: Partial<AgentProfileFormState>) {
    setForm((current) => ({ ...current, ...patch }));
  }

  function patchAgent(index: number, patch: Partial<AgentProfileAgentFormState>) {
    setForm((current) => ({
      ...current,
      agents: current.agents.map((agent, agentIndex) =>
        agentIndex === index ? { ...agent, ...patch } : agent,
      ),
    }));
  }

  function patchMainToolPolicy(toolPatch: Partial<AgentProfileToolPolicyFieldValues>) {
    setForm((current) => ({
      ...current,
      ...(toolPatch.allowedTools !== undefined ? { mainAllowedTools: toolPatch.allowedTools } : {}),
      ...(toolPatch.disallowedTools !== undefined ? { mainDisallowedTools: toolPatch.disallowedTools } : {}),
      ...(toolPatch.mcpServers !== undefined ? { mainMcpServers: toolPatch.mcpServers } : {}),
      ...(toolPatch.mcpTools !== undefined ? { mainMcpTools: toolPatch.mcpTools } : {}),
      ...(toolPatch.bashCommandAllowlist !== undefined
        ? { mainBashCommandAllowlist: toolPatch.bashCommandAllowlist }
        : {}),
      ...(toolPatch.bashCommandDenylist !== undefined
        ? { mainBashCommandDenylist: toolPatch.bashCommandDenylist }
        : {}),
      ...(toolPatch.filesystemRead !== undefined ? { mainFilesystemRead: toolPatch.filesystemRead } : {}),
      ...(toolPatch.filesystemWrite !== undefined ? { mainFilesystemWrite: toolPatch.filesystemWrite } : {}),
      ...(toolPatch.networkWebSearch !== undefined
        ? { mainNetworkWebSearch: toolPatch.networkWebSearch }
        : {}),
      ...(toolPatch.networkWebFetch !== undefined ? { mainNetworkWebFetch: toolPatch.networkWebFetch } : {}),
    }));
  }

  function addAgent(templateId: string): string | undefined {
    const existingAgent = form.agents.find((agent) => agent.templateId === templateId);
    if (existingAgent) {
      return existingAgent.agentKey;
    }
    const template = templates.find((entry) => entry.id === templateId);
    if (!template) {
      return undefined;
    }
    const provider = selectPresetDefaultProvider(providers);
    const nextAgent = createProfileAgentFormFromTemplate(template, {
      ...(provider && { provider }),
      existingAgentKeys: form.agents.map((agent) => agent.agentKey),
    });
    setForm((current) => {
      if (current.agents.some((agent) => agent.templateId === template.id)) {
        return current;
      }
      return { ...current, agents: [...current.agents, nextAgent] };
    });
    return nextAgent.agentKey;
  }

  function handleTemplateDragStart(event: DragEvent<HTMLElement>, templateId: string) {
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData(AGENT_TEMPLATE_DRAG_TYPE, templateId);
  }

  function handleCanvasDragOver(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }

  function handleCanvasDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const templateId = event.dataTransfer.getData(AGENT_TEMPLATE_DRAG_TYPE);
    if (templateId) {
      const agentKey = addAgent(templateId);
      if (agentKey) {
        setSelectedNode({ kind: "agent", agentKey });
      }
    }
  }

  function handlePaletteTemplateSelect(templateId: string) {
    const agentKey = addAgent(templateId);
    if (agentKey) {
      setSelectedNode({ kind: "agent", agentKey });
    }
  }

  function removeAgent(index: number) {
    const removingAgentKey = form.agents[index]?.agentKey;
    setForm((current) => ({
      ...current,
      agents: current.agents.filter((_, agentIndex) => agentIndex !== index),
    }));
    if (selectedAgentKey !== undefined && selectedAgentKey === removingAgentKey) {
      setSelectedNode(null);
    }
  }

  return (
    <div className="settings-modal-backdrop">
      <button
        type="button"
        className="settings-modal-backdrop-close"
        onClick={onClose}
        aria-label="关闭"
        title="关闭"
        disabled={busy}
      />
      <div
        className="settings-modal settings-modal-agent-profile"
        role="dialog"
        aria-modal="true"
        aria-labelledby="agent-profile-modal-title"
      >
        <header className="settings-modal-header">
          <div className="models-agent-profile-modal-heading">
            <div className="models-agent-profile-modal-title-row">
              <h2 id="agent-profile-modal-title" className="settings-modal-title">
                {modalTitle}
              </h2>
              <span className="models-agent-source-badge">{modalBadge}</span>
            </div>
            <p>{modalHint}</p>
          </div>
          <button
            type="button"
            className="mcp-icon-button"
            onClick={onClose}
            aria-label="关闭"
            title="关闭"
            disabled={busy}
          >
            <X size={18} />
          </button>
        </header>

        <div className="settings-modal-body mcp-editor-form models-agent-profile-form">
          <section className="models-agent-profile-form-section">
            <div className="models-agent-profile-meta-grid">
              <label className="mcp-field">
                <span className="mcp-field-label">Profile 名称</span>
                <input
                  className="mcp-field-input"
                  value={form.name}
                  disabled={busy}
                  onChange={(event) => patch({ name: event.target.value })}
                />
              </label>
              <div className="models-agent-profile-meta-badges">
                <span className="models-agent-domain-badge">{formatAgentDomainLabel(form.preset)}</span>
                <span className="models-agent-source-badge">
                  {form.source === "project" ? "项目" : "用户"}
                </span>
              </div>
            </div>
          </section>

          <section className="models-agent-profile-form-section">
            <div className="models-agent-profile-visual-builder">
              <aside className="models-agent-profile-palette" aria-label="子代理库">
                <div className="models-agent-profile-builder-head">
                  <h3 className="models-route-profile-section-title">子代理库</h3>
                  <span className="models-agent-source-badge">{selectableTemplates.length} 可选</span>
                </div>
                {templates.length === 0 ? (
                  <p className="mcp-list-empty">子代理库暂无模板。</p>
                ) : selectableTemplates.length === 0 ? (
                  <p className="mcp-list-empty">子代理库中的模板都已加入当前 Profile。</p>
                ) : (
                  <div className="models-agent-profile-palette-list">
                    {selectableTemplates.map((template) => (
                      <button
                        key={template.id}
                        type="button"
                        className="models-agent-profile-palette-card"
                        draggable={!busy}
                        disabled={busy}
                        onClick={() => handlePaletteTemplateSelect(template.id)}
                        onDragStart={(event) => handleTemplateDragStart(event, template.id)}
                      >
                        <span className="models-agent-profile-palette-card-main">
                          <span className="models-agent-profile-palette-title">{template.name}</span>
                          <span className="models-agent-domain-badge">
                            {formatAgentDomainLabel(template.domain)}
                          </span>
                        </span>
                        <span className="models-agent-profile-palette-desc">{template.description}</span>
                        <span className="models-agent-profile-palette-card-action">
                          <Plus size={14} />
                          加入
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </aside>

              <section
                className="models-agent-profile-canvas"
                aria-label="Agent Profile 画布"
                onDragOver={handleCanvasDragOver}
                onDrop={handleCanvasDrop}
              >
                <div className="models-agent-profile-builder-head">
                  <div>
                    <h3 className="models-route-profile-section-title">Agent Profile 画布</h3>
                    <p className="models-agent-profile-builder-subtitle">
                      主 Agent、Explore 和 {form.agents.length} 个子代理节点
                    </p>
                  </div>
                  <span className="models-agent-source-badge">
                    {form.mainSystemPromptPreset === "claude_code" ? "Claude Code 预设" : "自定义预设"}
                  </span>
                </div>

                <div className="models-agent-profile-canvas-stage">
                  <button
                    type="button"
                    className="models-agent-profile-node models-agent-profile-node-main"
                    disabled={busy}
                    onClick={() => setSelectedNode({ kind: "main" })}
                  >
                    <span className="models-agent-profile-node-type">Main Agent</span>
                    <span className="models-agent-profile-node-title">{form.mainName}</span>
                    <span className="models-agent-profile-node-model">
                      {(activeProvider?.name ?? form.mainProviderId) || "未选 Provider"} /{" "}
                      {form.mainModelId || "未选模型"}
                    </span>
                    <span className="models-agent-profile-node-footer">
                      <Settings2 size={14} />
                      配置
                    </span>
                  </button>

                  <div className="models-agent-profile-node-rail" aria-hidden />

                  <div className="models-agent-profile-node-column">
                    <article className="models-agent-profile-node-shell">
                      <button
                        type="button"
                        className="models-agent-profile-node models-agent-profile-node-builtin"
                        disabled={busy}
                        onClick={() => setSelectedNode({ kind: "builtinExplore" })}
                      >
                        <span className="models-agent-profile-node-type">内置代理</span>
                        <span className="models-agent-profile-node-title">Explore</span>
                        <span className="models-agent-profile-node-model">
                          {(builtinExploreProvider?.name ?? form.builtinExploreProviderId) ||
                            "未选 Provider"}{" "}
                          / {form.builtinExploreModelId || "未选模型"}
                        </span>
                        <span className="models-agent-profile-node-footer">
                          <Settings2 size={14} />
                          模型
                        </span>
                      </button>
                    </article>

                    {form.agents.length === 0 ? (
                      <div className="models-agent-profile-empty-drop">
                        <span>拖入子代理节点</span>
                        <small>子代理节点只绑定 Provider 和模型。</small>
                      </div>
                    ) : (
                      <div className="models-agent-profile-node-grid">
                        {form.agents.map((agent, index) => {
                          const provider = providers.find((entry) => entry.id === agent.providerId);
                          const template = templates.find((entry) => entry.id === agent.templateId);
                          const nodeTitle = (template?.name ?? agent.displayName) || agent.agentKey;
                          return (
                            <article key={agent.agentKey} className="models-agent-profile-node-shell">
                              <button
                                type="button"
                                className="models-agent-profile-node"
                                disabled={busy}
                                onClick={() =>
                                  setSelectedNode({ kind: "agent", agentKey: agent.agentKey })
                                }
                              >
                                <span className="models-agent-profile-node-type">
                                  {template ? formatAgentDomainLabel(template.domain) : "模板缺失"}
                                </span>
                                <span className="models-agent-profile-node-title">{nodeTitle}</span>
                                <span className="models-agent-profile-node-key">{agent.agentKey}</span>
                                <span className="models-agent-profile-node-model">
                                  {(provider?.name ?? agent.providerId) || "未选 Provider"} /{" "}
                                  {agent.modelId || "未选模型"}
                                </span>
                                <span className="models-agent-profile-node-footer">
                                  <Settings2 size={14} />
                                  模型
                                </span>
                              </button>
                              <button
                                type="button"
                                className="mcp-icon-button danger models-agent-profile-node-remove"
                                disabled={busy}
                                onClick={() => removeAgent(index)}
                                aria-label={`移除 ${nodeTitle}`}
                                title={`移除 ${nodeTitle}`}
                              >
                                <Trash2 size={16} />
                              </button>
                            </article>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </section>
            </div>
          </section>

          {error && <p className="settings-form-error">{error}</p>}
        </div>

        {selectedNode ? (
          <AgentProfileNodeConfigModal
            node={selectedNode}
            form={form}
            agent={selectedAgent}
            agentIndex={selectedAgentIndex}
            template={selectedAgentTemplate}
            templates={templates}
            mcpServers={mcpServers}
            skillsSnapshot={skillsSnapshot}
            providers={providers}
            modelsForProvider={modelsForProvider}
            modelsErrorForProvider={modelsErrorForProvider}
            loadingForProvider={loadingForProvider}
            modelsDevOptions={modelsDevOptions}
            modelsDevLoading={modelsDevLoading}
            capabilityHints={capabilityHints}
            pricingHints={pricingHints}
            busy={busy}
            onClose={() => setSelectedNode(null)}
            onPatchProfile={patch}
            onPatchAgent={patchAgent}
            onPatchMainToolPolicy={patchMainToolPolicy}
            onFetchModels={onFetchModels}
          />
        ) : null}

        <footer className="settings-modal-footer">
          <button type="button" className="settings-modal-cancel" onClick={onClose} disabled={busy}>
            取消
          </button>
          <button type="button" className="mcp-save-button" disabled={busy} onClick={onSave}>
            {saveLabel}
          </button>
        </footer>
      </div>
    </div>
  );
}

function valueHasManualMapping(
  isMain: boolean,
  isExplore: boolean,
  form: AgentProfileFormState,
  agent?: AgentProfileAgentFormState,
): boolean {
  if (isMain) {
    return Boolean(form.mainModelsDevMappingProviderKey && form.mainModelsDevMappingModelId);
  }
  if (isExplore) {
    return Boolean(
      form.builtinExploreModelsDevMappingProviderKey && form.builtinExploreModelsDevMappingModelId,
    );
  }
  return Boolean(agent?.modelsDevMappingProviderKey && agent?.modelsDevMappingModelId);
}

function ModelsDevCapabilitySummary({
  capability,
  pricing,
}: {
  capability?: RouteCapabilityHint;
  pricing?: RoutePricingHint;
}) {
  if (!capability && !pricing) {
    return null;
  }
  const cap = capability;
  const hasContext =
    cap?.contextLimitResolved && cap.contextTokens !== undefined && cap.contextTokens > 0;
  const hasOutput = cap?.maxOutputTokens !== undefined && cap.maxOutputTokens > 0;
  const hasImage = cap?.supportsImageInput;
  const hasReasoning = cap?.supportsReasoning;
  const rates = pricing?.rates;
  const hasPricing = rates && rates.inputPerM > 0 && rates.outputPerM > 0;
  const hasCache = rates && (rates.cacheReadPerM !== undefined || rates.cacheWritePerM !== undefined);

  if (!hasContext && !hasImage && !hasPricing && !hasOutput && !hasReasoning) {
    return null;
  }

  return (
    <div className="models-dev-capability-summary">
      {hasContext ? (
        <span className="models-dev-capability-chip" title="上下文窗口">
          <Eye size={14} />
          {cap!.contextTokens! >= 1_000_000
            ? `${(cap!.contextTokens! / 1_000_000).toFixed(1)}M`
            : `${Math.round(cap!.contextTokens! / 1000)}K`}{" "}
          上下文
        </span>
      ) : null}
      {hasOutput ? (
        <span className="models-dev-capability-chip" title="最大输出">
          <Zap size={14} />
          {cap!.maxOutputTokens! >= 1_000
            ? `${(cap!.maxOutputTokens! / 1000).toFixed(0)}K`
            : cap!.maxOutputTokens}{" "}
          输出
        </span>
      ) : null}
      {hasImage ? (
        <span className="models-dev-capability-chip" title="支持图像输入">
          <Image size={14} />
          多模态
        </span>
      ) : null}
      {hasReasoning ? (
        <span className="models-dev-capability-chip" title="支持推理">
          <Zap size={14} />
          推理
        </span>
      ) : null}
      {hasPricing ? (
        <>
          <span className="models-dev-capability-chip models-dev-capability-chip-price" title="输入价格 /M tokens">
            ↑{formatRatePerMillion(rates!.inputPerM)}
          </span>
          <span className="models-dev-capability-chip models-dev-capability-chip-price" title="输出价格 /M tokens">
            ↓{formatRatePerMillion(rates!.outputPerM)}
          </span>
        </>
      ) : null}
      {hasCache
        ? [
            rates?.cacheReadPerM !== undefined ? (
              <span
                key="cache-read"
                className="models-dev-capability-chip models-dev-capability-chip-cache"
                title="缓存读取价格 /M tokens"
              >
                ⊙{formatRatePerMillion(rates!.cacheReadPerM!)}
              </span>
            ) : null,
            rates?.cacheWritePerM !== undefined ? (
              <span
                key="cache-write"
                className="models-dev-capability-chip models-dev-capability-chip-cache"
                title="缓存写入价格 /M tokens"
              >
                ⊕{formatRatePerMillion(rates!.cacheWritePerM!)}
              </span>
            ) : null,
          ].filter(Boolean)
        : null}
    </div>
  );
}

function AgentProfileNodeConfigModal({
  node,
  form,
  agent,
  agentIndex,
  template,
  templates,
  mcpServers,
  skillsSnapshot,
  providers,
  modelsForProvider,
  modelsErrorForProvider,
  loadingForProvider,
  modelsDevOptions,
  modelsDevLoading,
  capabilityHints,
  pricingHints,
  busy,
  onClose,
  onPatchProfile,
  onPatchAgent,
  onPatchMainToolPolicy,
  onFetchModels,
}: {
  node: AgentProfileSelectedNode;
  form: AgentProfileFormState;
  agent?: AgentProfileAgentFormState | undefined;
  agentIndex: number;
  template?: AgentTemplate | undefined;
  templates: AgentTemplate[];
  mcpServers: McpServerConfigView[];
  skillsSnapshot?: SkillsListResult | undefined;
  providers: ProviderConfigView[];
  modelsForProvider: (providerId: string) => UpstreamModelOption[];
  modelsErrorForProvider: (providerId: string) => string | undefined;
  loadingForProvider: (providerId: string) => boolean;
  modelsDevOptions: readonly ModelsDevModelOption[];
  modelsDevLoading: boolean;
  capabilityHints: Record<string, RouteCapabilityHint>;
  pricingHints: Record<string, RoutePricingHint>;
  busy?: boolean | undefined;
  onClose: () => void;
  onPatchProfile: (patch: Partial<AgentProfileFormState>) => void;
  onPatchAgent: (index: number, patch: Partial<AgentProfileAgentFormState>) => void;
  onPatchMainToolPolicy: (patch: Partial<AgentProfileToolPolicyFieldValues>) => void;
  onFetchModels: (provider: ProviderConfigView) => void;
}) {
  const isMainNode = node.kind === "main";
  const isBuiltinExploreNode = node.kind === "builtinExplore";
  const nodeCapKey = isMainNode ? "main" : isBuiltinExploreNode ? "explore" : agent?.agentKey ?? "";
  const capability = capabilityHints[nodeCapKey];
  const pricing = pricingHints[nodeCapKey];
  const autoMatch =
    !valueHasManualMapping(isMainNode, isBuiltinExploreNode, form, agent) &&
    capability?.resolvedModelsDevMapping
      ? ({
          autoResolved: true as const,
          autoResolvedMapping: capability.resolvedModelsDevMapping,
          autoResolvedLabel: capability.resolvedModelsDevLabel,
        } as const)
      : ({ autoResolved: false as const });
  const mainProvider = providers.find((provider) => provider.id === form.mainProviderId);
  const builtinExploreProvider = providers.find(
    (provider) => provider.id === form.builtinExploreProviderId,
  );
  const agentProvider = agent ? providers.find((provider) => provider.id === agent.providerId) : undefined;
  const nodeTitle = isMainNode
    ? "主 Agent 配置"
    : isBuiltinExploreNode
      ? "Explore 配置"
      : `${template?.name ?? agent?.displayName ?? agent?.agentKey ?? "子代理"} 节点配置`;
  const mainCapabilityForm = useMemo(
    () => ({
      allowedTools: form.mainAllowedTools,
      disallowedTools: form.mainDisallowedTools,
      mcpServers: form.mainMcpServers,
      mcpTools: form.mainMcpTools,
      skills: form.mainSkills,
    }),
    [
      form.mainAllowedTools,
      form.mainDisallowedTools,
      form.mainMcpServers,
      form.mainMcpTools,
      form.mainSkills,
    ],
  );
  const mainCapabilityOptions = useMemo(
    () =>
      buildAgentTemplateCapabilityOptions({
        templates,
        form: mainCapabilityForm,
        mcpServers,
        skillsSnapshot,
      }),
    [templates, mainCapabilityForm, mcpServers, skillsSnapshot],
  );

  if (!isMainNode && !isBuiltinExploreNode && (!agent || agentIndex < 0)) {
    return null;
  }

  return (
    <div className="settings-modal-backdrop settings-modal-node-config-backdrop">
      <button
        type="button"
        className="settings-modal-backdrop-close"
        onClick={onClose}
        aria-label="关闭节点配置"
        title="关闭节点配置"
        disabled={busy}
      />
      <div
        className="settings-modal settings-modal-agent-node-config"
        role="dialog"
        aria-modal="true"
        aria-labelledby="agent-profile-node-config-title"
      >
        <header className="settings-modal-header">
          <h2 id="agent-profile-node-config-title" className="settings-modal-title">
            {nodeTitle}
          </h2>
          <button
            type="button"
            className="mcp-icon-button"
            onClick={onClose}
            aria-label="关闭"
            title="关闭"
            disabled={busy}
          >
            <X size={18} />
          </button>
        </header>

        <div className="settings-modal-body mcp-editor-form models-agent-profile-node-config-form">
          {isMainNode ? (
            <>
              <div className="models-agent-profile-template-summary">
                <div className="models-agent-profile-title-row">
                  <span className="models-route-role">{form.mainName}</span>
                  <span className="models-agent-source-badge">
                    {form.mainSystemPromptPreset === "claude_code" ? "Claude Code 预设" : "自定义预设"}
                  </span>
                </div>
                <p className="models-subagent-card-desc">
                  主 Agent 定义当前 Profile 的任务目标、编排边界和可用工具。
                </p>
              </div>

              <div className="models-agent-template-form-grid">
                <label className="mcp-field">
                  <span className="mcp-field-label">名称</span>
                  <input
                    className="mcp-field-input"
                    value={form.mainName}
                    disabled={busy}
                    onChange={(event) => onPatchProfile({ mainName: event.target.value })}
                  />
                </label>
                <label className="mcp-field">
                  <span className="mcp-field-label">系统提示词</span>
                  <select
                    className="mcp-field-input"
                    value={form.mainSystemPromptPreset}
                    disabled={busy}
                    onChange={(event) =>
                      onPatchProfile({
                        mainSystemPromptPreset: event.target
                          .value as AgentProfileFormState["mainSystemPromptPreset"],
                      })
                    }
                  >
                    <option value="custom">自定义</option>
                    <option value="claude_code">Claude Code 预设</option>
                  </select>
                </label>
                <label className="mcp-field">
                  <span className="mcp-field-label">Provider</span>
                  <select
                    className="mcp-field-input"
                    value={form.mainProviderId}
                    disabled={busy}
                    onChange={(event) => {
                      const provider = providers.find((entry) => entry.id === event.target.value);
                      onPatchProfile({
                        mainProviderId: event.target.value,
                        mainModelId: provider?.defaultModel || form.mainModelId,
                      });
                    }}
                  >
                    {providers.map((provider) => (
                      <option key={provider.id} value={provider.id}>
                        {provider.name}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="mcp-field">
                  <span className="mcp-field-label">模型</span>
                  <ModelSelectField
                    value={form.mainModelId}
                    disabled={busy}
                    models={modelsForProvider(form.mainProviderId)}
                    loading={loadingForProvider(form.mainProviderId)}
                    error={modelsErrorForProvider(form.mainProviderId)}
                    onChange={(modelId) => onPatchProfile({ mainModelId: modelId })}
                    onRefresh={mainProvider ? () => onFetchModels(mainProvider) : undefined}
                  />
                </div>
                <label className="mcp-field">
                  <span className="mcp-field-label">思考强度</span>
                  <select
                    className="mcp-field-input"
                    value={form.mainThinkingEffort}
                    disabled={busy}
                    onChange={(event) => onPatchProfile({ mainThinkingEffort: event.target.value })}
                  >
                    <option value="">默认</option>
                    <option value="off">关闭</option>
                    <option value="low">低</option>
                    <option value="medium">中</option>
                    <option value="high">高</option>
                    <option value="xhigh">极高</option>
                    <option value="max">最大</option>
                  </select>
                </label>
                <label className="mcp-field">
                  <span className="mcp-field-label">API 兼容模式</span>
                  <select
                    className="mcp-field-input"
                    value={form.mainApiCompat}
                    disabled={busy}
                    onChange={(event) => onPatchProfile({ mainApiCompat: event.target.value })}
                  >
                    <option value="">默认</option>
                    {UPSTREAM_API_COMPAT_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="models-agent-template-form-grid">
                <div className="mcp-field">
                  <span className="mcp-field-label">Models.dev 映射</span>
                  <ModelsDevModelSelectField
                    value={
                      form.mainModelsDevMappingProviderKey && form.mainModelsDevMappingModelId
                        ? {
                            providerKey: form.mainModelsDevMappingProviderKey,
                            modelId: form.mainModelsDevMappingModelId,
                          }
                        : undefined
                    }
                    options={modelsDevOptions}
                    loading={modelsDevLoading}
                    disabled={busy}
                    autoResolved={autoMatch.autoResolved}
                    autoResolvedMapping={autoMatch.autoResolved ? autoMatch.autoResolvedMapping : undefined}
                    autoResolvedLabel={autoMatch.autoResolved ? autoMatch.autoResolvedLabel : undefined}
                    onChange={(mapping) =>
                      onPatchProfile({
                        mainModelsDevMappingProviderKey: mapping?.providerKey ?? "",
                        mainModelsDevMappingModelId: mapping?.modelId ?? "",
                      })
                    }
                  />
                  <ModelsDevCapabilitySummary
                    {...(capability ? { capability } : {})}
                    {...(pricing ? { pricing } : {})}
                  />
                </div>
              </div>

              <label className="mcp-field">
                <span className="mcp-field-label">主 Agent 提示词</span>
                <textarea
                  className="mcp-field-input mcp-field-textarea models-agent-prompt-textarea"
                  value={form.mainPrompt}
                  disabled={busy}
                  onChange={(event) => onPatchProfile({ mainPrompt: event.target.value })}
                />
              </label>
              <AgentProfileToolPolicyFields
                disabled={busy}
                capabilityOptions={mainCapabilityOptions}
                values={{
                  allowedTools: form.mainAllowedTools,
                  disallowedTools: form.mainDisallowedTools,
                  mcpServers: form.mainMcpServers,
                  mcpTools: form.mainMcpTools,
                  bashCommandAllowlist: form.mainBashCommandAllowlist,
                  bashCommandDenylist: form.mainBashCommandDenylist,
                  filesystemRead: form.mainFilesystemRead,
                  filesystemWrite: form.mainFilesystemWrite,
                  networkWebSearch: form.mainNetworkWebSearch,
                  networkWebFetch: form.mainNetworkWebFetch,
                }}
                onChange={onPatchMainToolPolicy}
              />
              <AgentProfileSelectableTokenGroup
                label="Skills"
                options={mainCapabilityOptions.skills}
                selectedValues={parseList(form.mainSkills)}
                disabled={busy}
                emptyText="没有 SDK 可加载 Skills。"
                onToggle={(value, checked) =>
                  onPatchProfile({
                    mainSkills: toggleAgentTemplateListValue(form.mainSkills, value, checked),
                  })
                }
              />
            </>
          ) : isBuiltinExploreNode ? (
            <>
              <div className="models-agent-profile-template-summary">
                <div className="models-agent-profile-title-row">
                  <span className="models-route-role">Explore</span>
                  <span className="models-agent-source-badge">内置</span>
                </div>
                <p className="models-subagent-card-desc">
                  内置只读探索代理，用于代码库上下文发现，可绑定当前 Profile 的专用模型。
                </p>
              </div>

              <div className="models-agent-template-form-grid">
                <label className="mcp-field">
                  <span className="mcp-field-label">Provider</span>
                  <select
                    className="mcp-field-input"
                    value={form.builtinExploreProviderId}
                    disabled={busy}
                    onChange={(event) => {
                      const nextProvider = providers.find((entry) => entry.id === event.target.value);
                      onPatchProfile({
                        builtinExploreProviderId: event.target.value,
                        builtinExploreModelId:
                          nextProvider?.defaultModel || form.builtinExploreModelId || "",
                      });
                    }}
                  >
                    {providers.map((provider) => (
                      <option key={provider.id} value={provider.id}>
                        {provider.name}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="mcp-field">
                  <span className="mcp-field-label">模型</span>
                  <ModelSelectField
                    value={form.builtinExploreModelId}
                    disabled={busy}
                    models={modelsForProvider(form.builtinExploreProviderId)}
                    loading={loadingForProvider(form.builtinExploreProviderId)}
                    error={modelsErrorForProvider(form.builtinExploreProviderId)}
                    onChange={(modelId) => onPatchProfile({ builtinExploreModelId: modelId })}
                    onRefresh={
                      builtinExploreProvider ? () => onFetchModels(builtinExploreProvider) : undefined
                    }
                  />
                </div>
                <label className="mcp-field">
                  <span className="mcp-field-label">思考强度</span>
                  <select
                    className="mcp-field-input"
                    value={form.builtinExploreThinkingEffort}
                    disabled={busy}
                    onChange={(event) =>
                      onPatchProfile({ builtinExploreThinkingEffort: event.target.value })
                    }
                  >
                    <option value="">默认</option>
                    <option value="off">关闭</option>
                    <option value="low">低</option>
                    <option value="medium">中</option>
                    <option value="high">高</option>
                    <option value="xhigh">极高</option>
                    <option value="max">最大</option>
                  </select>
                </label>
              </div>
              <div className="models-agent-template-form-grid">
                <div className="mcp-field">
                  <span className="mcp-field-label">Models.dev 映射</span>
                  <ModelsDevModelSelectField
                    value={
                      form.builtinExploreModelsDevMappingProviderKey &&
                      form.builtinExploreModelsDevMappingModelId
                        ? {
                            providerKey: form.builtinExploreModelsDevMappingProviderKey,
                            modelId: form.builtinExploreModelsDevMappingModelId,
                          }
                        : undefined
                    }
                    options={modelsDevOptions}
                    loading={modelsDevLoading}
                    disabled={busy}
                    autoResolved={autoMatch.autoResolved}
                    autoResolvedMapping={autoMatch.autoResolved ? autoMatch.autoResolvedMapping : undefined}
                    autoResolvedLabel={autoMatch.autoResolved ? autoMatch.autoResolvedLabel : undefined}
                    onChange={(mapping) =>
                      onPatchProfile({
                        builtinExploreModelsDevMappingProviderKey: mapping?.providerKey ?? "",
                        builtinExploreModelsDevMappingModelId: mapping?.modelId ?? "",
                      })
                    }
                  />
                  <ModelsDevCapabilitySummary
                    {...(capability ? { capability } : {})}
                    {...(pricing ? { pricing } : {})}
                  />
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="models-agent-profile-template-summary">
                <div className="models-agent-profile-title-row">
                  <span className="models-route-role">
                    {template?.name ?? agent?.displayName ?? agent?.agentKey}
                  </span>
                  {template ? (
                    <span className="models-agent-domain-badge">
                      {formatAgentDomainLabel(template.domain)}
                    </span>
                  ) : (
                    <span className="models-agent-source-badge">模板缺失</span>
                  )}
                  <span className="models-route-role-id">{agent?.agentKey}</span>
                </div>
                <p className="models-subagent-card-desc">
                  {template?.description ?? `引用模板：${agent?.templateId ?? ""}`}
                </p>
              </div>

              <div className="models-agent-template-form-grid">
                <label className="mcp-field">
                  <span className="mcp-field-label">Provider</span>
                  <select
                    className="mcp-field-input"
                    value={agent?.providerId ?? ""}
                    disabled={busy}
                    onChange={(event) => {
                      const nextProvider = providers.find((entry) => entry.id === event.target.value);
                      onPatchAgent(agentIndex, {
                        providerId: event.target.value,
                        modelId: nextProvider?.defaultModel || agent?.modelId || "",
                      });
                    }}
                  >
                    {providers.map((provider) => (
                      <option key={provider.id} value={provider.id}>
                        {provider.name}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="mcp-field">
                  <span className="mcp-field-label">模型</span>
                  <ModelSelectField
                    value={agent?.modelId ?? ""}
                    disabled={busy}
                    models={modelsForProvider(agent?.providerId ?? "")}
                    loading={loadingForProvider(agent?.providerId ?? "")}
                    error={modelsErrorForProvider(agent?.providerId ?? "")}
                    onChange={(modelId) => onPatchAgent(agentIndex, { modelId })}
                    onRefresh={agentProvider ? () => onFetchModels(agentProvider) : undefined}
                  />
                </div>
                <label className="mcp-field">
                  <span className="mcp-field-label">思考强度</span>
                  <select
                    className="mcp-field-input"
                    value={agent?.thinkingEffort ?? ""}
                    disabled={busy}
                    onChange={(event) =>
                      onPatchAgent(agentIndex, { thinkingEffort: event.target.value })
                    }
                  >
                    <option value="">默认</option>
                    <option value="off">关闭</option>
                    <option value="low">低</option>
                    <option value="medium">中</option>
                    <option value="high">高</option>
                    <option value="xhigh">极高</option>
                    <option value="max">最大</option>
                  </select>
                </label>
              </div>
              <div className="models-agent-template-form-grid">
                <div className="mcp-field">
                  <span className="mcp-field-label">Models.dev 映射</span>
                  <ModelsDevModelSelectField
                    value={
                      agent?.modelsDevMappingProviderKey && agent?.modelsDevMappingModelId
                        ? {
                            providerKey: agent.modelsDevMappingProviderKey,
                            modelId: agent.modelsDevMappingModelId,
                          }
                        : undefined
                    }
                    options={modelsDevOptions}
                    loading={modelsDevLoading}
                    disabled={busy}
                    autoResolved={autoMatch.autoResolved}
                    autoResolvedMapping={autoMatch.autoResolved ? autoMatch.autoResolvedMapping : undefined}
                    autoResolvedLabel={autoMatch.autoResolved ? autoMatch.autoResolvedLabel : undefined}
                    onChange={(mapping) =>
                      onPatchAgent(agentIndex, {
                        modelsDevMappingProviderKey: mapping?.providerKey ?? "",
                        modelsDevMappingModelId: mapping?.modelId ?? "",
                      })
                    }
                  />
                  <ModelsDevCapabilitySummary
                    {...(capability ? { capability } : {})}
                    {...(pricing ? { pricing } : {})}
                  />
                </div>
              </div>
            </>
          )}
        </div>

        <footer className="settings-modal-footer">
          <button type="button" className="settings-modal-cancel" onClick={onClose} disabled={busy}>
            关闭
          </button>
        </footer>
      </div>
    </div>
  );
}

function AgentProfileToolPolicyFields({
  values,
  disabled,
  capabilityOptions,
  onChange,
}: {
  values: AgentProfileToolPolicyFieldValues;
  disabled?: boolean | undefined;
  capabilityOptions: {
    tools: AgentTemplateCapabilityOption[];
    mcpServers: AgentTemplateCapabilityOption[];
    mcpTools: AgentTemplateCapabilityOption[];
  };
  onChange: (patch: Partial<AgentProfileToolPolicyFieldValues>) => void;
}) {
  return (
    <div className="models-agent-profile-tool-policy">
      <div className="models-agent-template-form-grid">
        <AgentProfileSelectableTokenGroup
          label="允许工具"
          options={capabilityOptions.tools}
          selectedValues={parseList(values.allowedTools)}
          disabled={disabled}
          onToggle={(value, checked) =>
            onChange(
              toggleAgentTemplateToolSelection(
                {
                  allowedTools: values.allowedTools,
                  disallowedTools: values.disallowedTools,
                },
                "allowedTools",
                value,
                checked,
              ),
            )
          }
        />
        <AgentProfileSelectableTokenGroup
          label="禁用工具"
          tone="danger"
          options={capabilityOptions.tools}
          selectedValues={parseList(values.disallowedTools)}
          disabled={disabled}
          onToggle={(value, checked) =>
            onChange(
              toggleAgentTemplateToolSelection(
                {
                  allowedTools: values.allowedTools,
                  disallowedTools: values.disallowedTools,
                },
                "disallowedTools",
                value,
                checked,
              ),
            )
          }
        />
        <AgentProfileSelectableTokenGroup
          label="MCP Servers"
          options={capabilityOptions.mcpServers}
          selectedValues={parseList(values.mcpServers)}
          disabled={disabled}
          emptyText="没有可选 MCP Server。"
          onToggle={(value, checked) =>
            onChange({ mcpServers: toggleAgentTemplateListValue(values.mcpServers, value, checked) })
          }
        />
        <AgentProfileSelectableTokenGroup
          label="MCP Tools"
          options={capabilityOptions.mcpTools}
          selectedValues={parseList(values.mcpTools)}
          disabled={disabled}
          emptyText="没有 MCP 工具模式。"
          onToggle={(value, checked) =>
            onChange({ mcpTools: toggleAgentTemplateListValue(values.mcpTools, value, checked) })
          }
        />
        <label className="mcp-field">
          <span className="mcp-field-label">命令白名单</span>
          <input
            className="mcp-field-input"
            value={values.bashCommandAllowlist}
            disabled={disabled}
            onChange={(event) => onChange({ bashCommandAllowlist: event.target.value })}
          />
        </label>
        <label className="mcp-field">
          <span className="mcp-field-label">命令黑名单</span>
          <input
            className="mcp-field-input"
            value={values.bashCommandDenylist}
            disabled={disabled}
            onChange={(event) => onChange({ bashCommandDenylist: event.target.value })}
          />
        </label>
        <label className="mcp-field">
          <span className="mcp-field-label">文件读取</span>
          <select
            className="mcp-field-input"
            value={values.filesystemRead}
            disabled={disabled}
            onChange={(event) =>
              onChange({
                filesystemRead: event.target.value as AgentProfileToolPolicyFieldValues["filesystemRead"],
              })
            }
          >
            <option value="workspace">工作区</option>
            <option value="extra_dirs">工作区+扩展</option>
            <option value="none">禁用</option>
          </select>
        </label>
        <label className="mcp-field">
          <span className="mcp-field-label">文件写入</span>
          <select
            className="mcp-field-input"
            value={values.filesystemWrite}
            disabled={disabled}
            onChange={(event) =>
              onChange({
                filesystemWrite: event.target.value as AgentProfileToolPolicyFieldValues["filesystemWrite"],
              })
            }
          >
            <option value="workspace">工作区</option>
            <option value="none">禁用</option>
          </select>
        </label>
        <label className="mcp-field models-toggle-field">
          <span className="mcp-field-label">WebSearch</span>
          <label className="mcp-toggle" title={values.networkWebSearch ? "已启用" : "已禁用"}>
            <input
              type="checkbox"
              checked={values.networkWebSearch}
              disabled={disabled}
              onChange={(event) => onChange({ networkWebSearch: event.target.checked })}
            />
            <span className="mcp-toggle-track" aria-hidden />
          </label>
        </label>
        <label className="mcp-field models-toggle-field">
          <span className="mcp-field-label">WebFetch</span>
          <label className="mcp-toggle" title={values.networkWebFetch ? "已启用" : "已禁用"}>
            <input
              type="checkbox"
              checked={values.networkWebFetch}
              disabled={disabled}
              onChange={(event) => onChange({ networkWebFetch: event.target.checked })}
            />
            <span className="mcp-toggle-track" aria-hidden />
          </label>
        </label>
      </div>
    </div>
  );
}

function AgentProfileSelectableTokenGroup({
  label,
  options,
  selectedValues,
  disabled,
  tone,
  emptyText = "暂无可选项。",
  onToggle,
}: {
  label: string;
  options: AgentTemplateCapabilityOption[];
  selectedValues: string[];
  disabled?: boolean | undefined;
  tone?: "danger" | undefined;
  emptyText?: string | undefined;
  onToggle: (value: string, checked: boolean) => void;
}) {
  const selected = new Set(selectedValues);
  return (
    <section className="models-agent-token-group">
      <div className="models-agent-token-group-head">
        <span>{label}</span>
        <small>{selectedValues.length} 已选</small>
      </div>
      {options.length === 0 ? (
        <p className="models-agent-token-empty">{emptyText}</p>
      ) : (
        <div className="models-agent-token-options">
          {options.map((option) => {
            const active = selected.has(option.value);
            const optionDisabled = disabled || (option.disabled && !active);
            const className = [
              "models-agent-token-option",
              active ? "active" : "",
              tone === "danger" ? "danger" : "",
              optionDisabled ? "is-disabled" : "",
            ]
              .filter(Boolean)
              .join(" ");
            return (
              <label key={option.value} className={className} title={option.description ?? option.label}>
                <input
                  type="checkbox"
                  checked={active}
                  disabled={optionDisabled}
                  onChange={(event) => onToggle(option.value, event.target.checked)}
                />
                <span className="models-agent-token-name">{option.label}</span>
                <span className="models-agent-token-source">{option.sourceLabel}</span>
              </label>
            );
          })}
        </div>
      )}
    </section>
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
    <div className="settings-modal-backdrop">
      <button
        type="button"
        className="settings-modal-backdrop-close"
        onClick={onClose}
        aria-label="关闭"
        title="关闭"
        disabled={busy}
      />
      <div className="settings-modal" role="dialog" aria-modal="true" aria-labelledby="provider-modal-title">
        <header className="settings-modal-header">
          <h2 id="provider-modal-title" className="settings-modal-title">
            {title}
          </h2>
          <button
            type="button"
            className="mcp-icon-button"
            onClick={onClose}
            aria-label="关闭"
            title="关闭"
            disabled={busy}
          >
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
                onChange={(event) => setForm((current) => ({ ...current, requestPath: event.target.value }))}
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

function AgentProfileSummaryBlock({ summary }: { summary: AgentProfileSummary }) {
  const visibleAgents = summary.enabledAgents.slice(0, 5);
  const hiddenCount = Math.max(0, summary.enabledAgents.length - visibleAgents.length);
  return (
    <div className="models-agent-profile-main">
      <div className="models-agent-profile-title-row">
        <span className="mcp-server-name">{summary.name}</span>
        <span className="models-agent-domain-badge">{summary.presetLabel}</span>
        <span className="models-agent-source-badge">{summary.sourceLabel}</span>
      </div>
      <div className="models-agent-profile-meta">
        <span>主 Agent：{summary.main.modelLabel}</span>
        <span>{summary.enabledAgents.length} 个启用子代理</span>
        {summary.disabledAgentCount > 0 ? <span>{summary.disabledAgentCount} 个停用</span> : null}
      </div>
      {summary.highRiskLabels.length > 0 ? (
        <div className="models-agent-profile-risks">
          {summary.highRiskLabels.map((label) => (
            <span key={label} className="models-agent-profile-risk">
              {label}
            </span>
          ))}
        </div>
      ) : null}
      <div className="models-agent-profile-agents">
        {visibleAgents.map((agent) => (
          <span key={agent.agentKey} className="models-agent-profile-agent-pill">
            <span className="models-agent-profile-agent-name">{agent.name}</span>
            <span className="models-agent-profile-agent-model" title={agent.modelLabel}>
              {formatModelPreview(agent.modelLabel)}
            </span>
          </span>
        ))}
        {hiddenCount > 0 ? (
          <span className="models-agent-profile-agent-pill">
            <span className="models-agent-profile-agent-name">更多</span>
            <span className="models-agent-profile-agent-model">+{hiddenCount}</span>
          </span>
        ) : null}
      </div>
    </div>
  );
}

function AgentProfilePerformanceStrip({
  performance,
  loading,
}: {
  performance?: AgentProfilePerformanceSnapshot | undefined;
  loading: boolean;
}) {
  if (!performance || performance.runCount === 0) {
    return (
      <div className="models-agent-profile-performance muted">
        <span>{loading ? "刷新中" : "暂无历史表现"}</span>
      </div>
    );
  }
  return (
    <div className="models-agent-profile-performance">
      <span className="models-agent-profile-performance-pill">运行 {performance.runCount}</span>
      <span className="models-agent-profile-performance-pill">
        成功率 {formatPerformanceSuccessRate(performance)}
      </span>
      <span className="models-agent-profile-performance-pill">
        平均 {formatPerformanceDuration(performance.avgDurationMs)}
      </span>
      <span className="models-agent-profile-performance-pill">
        Token {formatPerformanceTokens(performance.totalTokens)}
      </span>
      <span className="models-agent-profile-performance-pill">
        成本 {formatCostUsd(performance.ecoCostUsd)}
      </span>
      {performance.latestRunAt ? (
        <span className="models-agent-profile-performance-pill">
          最近 {formatPerformanceDate(performance.latestRunAt)}
        </span>
      ) : null}
    </div>
  );
}

function formatPerformanceSuccessRate(performance: AgentProfilePerformanceSnapshot): string {
  return performance.successRatePct === undefined ? "—" : `${performance.successRatePct.toFixed(1)}%`;
}

function formatPerformanceDuration(durationMs: number | undefined): string {
  return durationMs === undefined ? "—" : formatDurationMs(durationMs);
}

function formatPerformanceTokens(tokens: number): string {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(tokens);
}

function formatPerformanceDate(value: string): string {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) {
    return "—";
  }
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(time);
}

function PresetOverview({
  presets,
  templates,
  profiles,
  busy,
  copyingPresetId,
  onCopyPreset,
}: {
  presets: readonly BuiltInPresetDefinition[];
  templates: readonly AgentTemplate[];
  profiles: readonly AgentProfileSummary[];
  busy?: boolean;
  copyingPresetId?: string | null;
  onCopyPreset: (preset: BuiltInPresetDefinition) => void;
}) {
  const templateById = new Map(templates.map((template) => [template.id, template]));
  return (
    <div className="models-preset-grid">
      {presets.map((preset) => {
        const domainTemplates = templates.filter((template) => template.domain === preset.id);
        const domainProfiles = profiles.filter((summary) => summary.profile.preset === preset.id);
        const missingDefaultAgents = preset.defaultAgents.filter(
          (agent) => !templateById.has(agent.templateId),
        );
        const runnable = domainProfiles.some((profile) => profile.selectionId);
        const primaryExample = preset.examples[0];
        return (
          <article
            key={preset.id}
            className={runnable ? "models-preset-panel is-ready" : "models-preset-panel"}
          >
            <div className="models-preset-card-top">
              <div className="models-preset-title-block">
                <span className="models-preset-name">{formatAgentDomainLabel(preset.id)}</span>
                <span className="models-preset-description">{preset.description}</span>
              </div>
              <span className={runnable ? "models-provider-badge on" : "models-provider-badge"}>
                {runnable ? "可运行" : "模板可用"}
              </span>
            </div>

            <div className="models-preset-metrics">
              <span>
                <strong>{preset.defaultAgents.length}</strong>
                子代理
              </span>
              <span>
                <strong>{domainTemplates.length}</strong>
                模板
              </span>
              <span>
                <strong>{domainProfiles.length}</strong>
                Profile
              </span>
              <span>
                <strong>{preset.evals.length}</strong>
                Eval
              </span>
            </div>

            <div className="models-preset-agent-strip">
              {preset.defaultAgents.map((agent) => {
                const template = templateById.get(agent.templateId);
                return (
                  <span
                    key={agent.agentKey}
                    className={template ? "models-preset-template" : "models-preset-template is-missing"}
                  >
                    {template?.name ?? agent.displayName}
                  </span>
                );
              })}
              {missingDefaultAgents.length > 0 ? (
                <span className="models-preset-template is-missing">缺失 {missingDefaultAgents.length}</span>
              ) : null}
            </div>

            <div className="models-preset-focus">
              <span>默认 Agent Profile</span>
              <p>{primaryExample?.title ?? preset.modelSuggestion.main}</p>
            </div>

            <div className="models-preset-footer">
              <span className="models-preset-model-suggestion">{preset.modelSuggestion.main}</span>
              <button
                type="button"
                className="models-section-button"
                disabled={busy}
                onClick={() => onCopyPreset(preset)}
                title={`从 ${formatAgentDomainLabel(preset.id)} 创建 Agent Profile`}
              >
                <Plus size={14} />
                {copyingPresetId === preset.id ? "创建中" : "复制为 Profile"}
              </button>
            </div>
          </article>
        );
      })}
    </div>
  );
}

function PresetEvaluationOverview({
  scenarios,
  results,
}: {
  scenarios: readonly BuiltInPresetEvalScenario[];
  results: readonly PresetEvalValidationResult[];
}) {
  const resultById = new Map(results.map((result) => [result.scenarioId, result]));
  const presetIds = Array.from(new Set(scenarios.map((scenario) => scenario.presetId)));
  const failedCount = results.filter((result) => !result.ok).length;
  return (
    <div className="models-evaluation-layout">
      <div className="models-evaluation-summary">
        <span className={failedCount === 0 ? "models-provider-badge on" : "models-provider-badge"}>
          {failedCount === 0 ? "全部通过" : `${failedCount} 个失败`}
        </span>
        <span>{scenarios.length} 个 eval case</span>
        <span>{presetIds.length} 个 preset</span>
      </div>
      <div className="models-evaluation-grid">
        {presetIds.map((presetId) => {
          const presetScenarios = scenarios.filter((scenario) => scenario.presetId === presetId);
          const presetResults = presetScenarios.map((scenario) => resultById.get(scenario.id));
          const failedResults = presetResults.filter((result) => result && !result.ok);
          return (
            <article key={presetId} className="models-evaluation-panel">
              <div className="models-preset-panel-head">
                <div className="models-preset-title-block">
                  <span className="models-preset-name">{formatAgentDomainLabel(presetId)}</span>
                  <span className="models-preset-description">{presetScenarios.length} 个配置级 eval</span>
                </div>
                <span
                  className={
                    failedResults.length === 0 ? "models-provider-badge on" : "models-provider-badge"
                  }
                >
                  {failedResults.length === 0 ? "通过" : `${failedResults.length} 失败`}
                </span>
              </div>
              <ul className="models-evaluation-case-list">
                {presetScenarios.map((scenario) => {
                  const result = resultById.get(scenario.id);
                  return (
                    <li key={scenario.id} className={result?.ok ? "is-pass" : "is-fail"}>
                      <div className="models-evaluation-case-head">
                        <span>{scenario.evalTitle}</span>
                        <span>{result?.ok ? "PASS" : "FAIL"}</span>
                      </div>
                      <p>{scenario.userPrompt}</p>
                      <div className="models-preset-template-list">
                        {scenario.expectedAgentKeys.map((agentKey) => (
                          <span key={agentKey} className="models-preset-template">
                            {agentKey}
                          </span>
                        ))}
                      </div>
                      {result && result.errors.length > 0 ? (
                        <ul className="models-evaluation-error-list">
                          {result.errors.map((error) => (
                            <li key={error}>{error}</li>
                          ))}
                        </ul>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </article>
          );
        })}
      </div>
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

function formatVersionTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
}

function formatAgentProfileVersionSummary(profile: OrchestrationProfile): string {
  const enabledAgents = profile.agents.filter((agent) => agent.enabled);
  return `${formatAgentDomainLabel(profile.preset)} · 主模型 ${profile.mainAgent.modelRef.modelId} · ${enabledAgents.length} 个子 Agent`;
}

function selectPresetDefaultProvider(
  providers: readonly ProviderConfigView[],
): ProviderConfigView | undefined {
  return (
    providers.find((provider) => provider.enabled && provider.defaultModel.trim()) ??
    providers.find((provider) => provider.defaultModel.trim())
  );
}

function modelRefFromProvider(provider: ProviderConfigView): ModelRef {
  return {
    providerId: provider.id,
    modelId: provider.defaultModel,
    apiCompat: provider.apiCompat,
  };
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
