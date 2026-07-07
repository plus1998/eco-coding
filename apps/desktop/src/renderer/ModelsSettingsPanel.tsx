import {
  ArrowUp,
  Copy,
  Download,
  ChevronRight,
  LinkIcon,
  Pencil,
  Plus,
  RefreshCw,
  Settings2,
  Trash2,
  X,
} from "lucide-react";
import {
  type Dispatch,
  type DragEvent,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
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
  AgentTemplate,
  CandidateModelView,
  McpServerConfigView,
  ModelRef,
  ModelSettingsSnapshot,
  ModelsDevModelOption,
  OrchestrationProfile,
  ProviderConfigInput,
  ProviderConfigView,
  ProxyBridgeSettingsSnapshot,
  SkillsListResult,
} from "../shared/ipc";
import { ROUTE_TEST_THINKING_EFFORT, type UpstreamModelOption } from "../shared/models";
import { runtimeRoleRoutesFromAgentProfile } from "../shared/thread-runtime-config";
import { ApiCompatToggle } from "./ApiCompatToggle";
import { AppMessage, type AppMessageKind, formatDurationMs } from "./AppMessage";
import {
  type AgentProfileAgentFormState,
  type AgentProfileFormState,
  agentCapabilityFromAgentForm,
  agentCapabilityPatchToAgentForm,
  agentProfileToForm,
  buildOrchestrationProfileFromForm,
  canEditStoredAgentProfile,
  createBlankAgentProfileForm,
  createCopiedAgentProfileForm,
  createProfileAgentFormFromTemplate,
  mainCapabilityFromProfileForm,
  mainCapabilityPatchToProfileForm,
} from "./agent-profile-form";
import {
  type AgentProfileSummary,
  buildAgentProfileSummary,
  formatAgentDomainLabel,
  listSelectableAgentProfileSummaries,
} from "./agent-profile-summary";
import { AgentThemeColorField } from "./agent-theme-color-field";
import { buildAgentTemplateCapabilityOptions } from "./agent-template-form";
import { CandidateModelPanel, type CandidateModelPanelHandle } from "./CandidateModelListSection";
import { CandidateModelSpecPanel } from "./ModelSpecSummary";
import { ProxyBridgeSettingsSection } from "./ProxyBridgeSettingsSection";
import { buildPresetTemplateImportPlan } from "./preset-import";
import {
  applyProviderPreset,
  FREE_TOKEN_PROVIDER_PRESETS,
  findMatchingProviderPreset,
  formatProviderPresetSelectLabel,
} from "./provider-presets";
import { SubagentSettingsSection } from "./SubagentSettingsSection";
import { ToolCapabilityPanel } from "./ToolCapabilityPanel";

export type ModelsSettingsTab =
  | "subagents"
  | "routes"
  | "providers"
  | "proxyBridge"
  | "presets"
  | "evaluation";

const MODELS_TAB_ITEMS: Array<{ id: ModelsSettingsTab; label: string }> = [
  { id: "subagents", label: "智能体库" },
  { id: "routes", label: "智能体配置" },
  { id: "presets", label: "场景预设" },
  { id: "evaluation", label: "效果评测" },
];

const PROVIDER_SETTINGS_TAB_ITEMS: Array<{ id: ModelsSettingsTab; label: string }> = [
  { id: "providers", label: "模型服务商" },
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
  const [modelsDevOptions, setModelsDevOptions] = useState<ModelsDevModelOption[]>([]);
  const [modelsDevLoading, setModelsDevLoading] = useState(false);
  const [profileArchiveMessage, setProfileArchiveMessage] = useState<{
    kind: AppMessageKind;
    message: string;
  }>();
  const [profileArchiveBusy, setProfileArchiveBusy] = useState(false);
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

  const exportAgentProfiles = useCallback(async (profileIds?: string[]) => {
    if (!window.eco?.exportOrchestrationProfiles) {
      setProfileArchiveMessage({ kind: "error", message: "智能体配置导出接口不可用。" });
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
        message: `已导出 ${result.exported} 个智能体配置${result.path ? `：${result.path}` : ""}`,
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
      setProfileArchiveMessage({ kind: "error", message: "智能体配置导入接口不可用。" });
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
            ? `已导入 ${result.imported} 个智能体配置，${result.errors.length} 个失败`
            : `已导入 ${result.imported} 个智能体配置`,
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
          message: "请先在模型服务商设置中配置至少一个启用且带默认模型的模型服务商。",
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
          message: `${templateMessage}并创建智能体配置「${profile.name}」，默认使用 ${provider.name} / ${provider.defaultModel}。`,
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
    if (!window.confirm(`确定删除智能体配置「${profile.name}」？`)) {
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
      setModalError("至少保留一个模型服务商。");
      return;
    }
    const providerName = providerForm.name.trim() || "模型服务商";
    if (
      !window.confirm(`确定删除模型服务商「${providerName}」？引用它的智能体配置将改用其他模型服务商。`)
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
            ? `（${uniqueModels.size} 组模型服务商+模型，共 ${result.passed} 个 Agent）`
            : "";
        setAgentProfileTestMessage({
          kind: "success",
          message: `智能体配置「${profile.name}」全部 ${result.passed} 个 Agent 已通过 /v1/messages 测试${dedupeHint}${durationHint}`,
        });
      } else {
        const failedLabels = result.results
          .filter((entry) => !entry.ok)
          .map((entry) => `${displayNames.get(entry.role) ?? entry.role}：${entry.error ?? "失败"}`)
          .join("；");
        setAgentProfileTestMessage({
          kind: "error",
          message: `智能体配置「${profile.name}」${result.passed}/${result.results.length} 通过。失败：${failedLabels}`,
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
    const providerName = target.name.trim() || "模型服务商";
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
      {profileArchiveMessage && (
        <AppMessage
          kind={profileArchiveMessage.kind}
          message={profileArchiveMessage.message}
          onDismiss={() => setProfileArchiveMessage(undefined)}
        />
      )}

      {mode === "providerSettings" ? (
        <header className="mcp-page-header">
          <h1>模型服务商</h1>
        </header>
      ) : (
        <header className="settings-page-header">
          <h1>智能体构建器</h1>
        </header>
      )}

      <div
        className="models-settings-tabs"
        role="tablist"
        aria-label={mode === "providerSettings" ? "模型服务商设置分类" : "模型设置分类"}
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
        <SubagentSettingsSection
          templates={settings.agentTemplates}
          mcpServers={mcpServers}
          registryDisabled={busy}
          onRegistryChange={refreshSettings}
          onSavingChange={onSavingChange}
        />
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
          <div className="mcp-list-toolbar">
            <span className="mcp-list-toolbar-label">模型服务商</span>
            <button type="button" className="mcp-add-button" disabled={busy} onClick={openCreateProvider}>
              <Plus size={16} />
              添加模型服务商
            </button>
          </div>

          {providerOptions.length === 0 ? (
            <p className="mcp-list-empty">尚未添加模型服务商</p>
          ) : (
            <ul className="mcp-server-list">
              {providerOptions.map((provider) => (
                <li key={provider.id} className="mcp-server-row">
                  <span className="mcp-server-name">{provider.name}</span>
                  <div className="mcp-server-actions">
                    <button
                      type="button"
                      className="mcp-icon-button"
                      onClick={() => openEditProvider(provider)}
                      aria-label={`配置 ${provider.name}`}
                      disabled={busy}
                    >
                      <Settings2 size={18} />
                    </button>
                    <label className="mcp-toggle mcp-toggle-sm" title={provider.enabled ? "已启用" : "已禁用"}>
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
      )}

      {activeTab === "routes" && (
        <section className="mcp-list-section models-routes-section">
          <div className="mcp-list-toolbar mcp-list-toolbar--actions-end">
            <div className="models-route-toolbar-actions">
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
                添加智能体配置
              </button>
            </div>
          </div>

          {selectableProfileSummaries.length === 0 ? (
            <p className="mcp-list-empty">尚未添加可运行的智能体配置</p>
          ) : (
            <ul className="mcp-server-list">
              {selectableProfileSummaries.map((summary) => {
                const editableProfile = canEditStoredAgentProfile(summary.profile);
                const testingProfile = testingAgentProfileId === summary.profile.id;
                return (
                  <li key={summary.profile.id} className="mcp-server-row models-agent-profile-row">
                    <AgentProfileSummaryBlock summary={summary} />
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
          modelsDevOptions={modelsDevOptions}
          modelsDevLoading={modelsDevLoading}
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
          error={agentProfileModalError}
          busy={busy}
          mode={agentProfileEditorMode}
          onClose={closeAgentProfileModal}
          onSave={() => void saveAgentProfile()}
        />
      )}
    </>
  );
}

const AGENT_TEMPLATE_DRAG_TYPE = "application/x-eco-agent-template";

type AgentProfileSelectedNode =
  | { kind: "main" }
  | { kind: "builtinExplore" }
  | { kind: "agent"; agentKey: string };

function AgentProfileEditorModal({
  form,
  setForm,
  providers,
  templates,
  mcpServers,
  error,
  busy,
  mode,
  onClose,
  onSave,
}: {
  form: AgentProfileFormState;
  setForm: Dispatch<SetStateAction<AgentProfileFormState>>;
  providers: ProviderConfigView[];
  templates: AgentTemplate[];
  mcpServers: McpServerConfigView[];
  error?: string | undefined;
  busy?: boolean | undefined;
  mode: AgentProfileEditorMode;
  onClose: () => void;
  onSave: () => void;
}) {
  const modalTitle =
    mode === "edit" ? "编辑智能体配置" : mode === "copy" ? "复制为智能体配置" : "新建智能体配置";
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

  function patchMainToolPolicy(toolPatch: Parameters<typeof mainCapabilityPatchToProfileForm>[0]) {
    setForm((current) => ({
      ...current,
      ...mainCapabilityPatchToProfileForm(toolPatch),
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
                aria-label="智能体配置画布"
                onDragOver={handleCanvasDragOver}
                onDrop={handleCanvasDrop}
              >
                <div className="models-agent-profile-builder-head">
                  <div>
                    <h3 className="models-route-profile-section-title">智能体配置画布</h3>
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
                      {(activeProvider?.name ?? form.mainProviderId) || "未选模型服务商"} /{" "}
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
                          {(builtinExploreProvider?.name ?? form.builtinExploreProviderId) || "未选模型服务商"}{" "}
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
                        <small>子代理节点只绑定模型服务商和模型。</small>
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
                                onClick={() => setSelectedNode({ kind: "agent", agentKey: agent.agentKey })}
                              >
                                <span className="models-agent-profile-node-type">
                                  {template ? formatAgentDomainLabel(template.domain) : "模板缺失"}
                                </span>
                                <span className="models-agent-profile-node-title">{nodeTitle}</span>
                                <span className="models-agent-profile-node-key">{agent.agentKey}</span>
                                <span className="models-agent-profile-node-model">
                                  {(provider?.name ?? agent.providerId) || "未选模型服务商"} /{" "}
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
            providers={providers}
            busy={busy}
            onClose={() => setSelectedNode(null)}
            onPatchProfile={patch}
            onPatchAgent={patchAgent}
            onPatchMainToolPolicy={patchMainToolPolicy}
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

function CandidateModelSelectField({
  value,
  candidates,
  loading,
  disabled,
  onChange,
}: {
  value: string;
  candidates: CandidateModelView[];
  loading: boolean;
  disabled?: boolean;
  onChange: (candidateId: string) => void;
}) {
  return (
    <div className="mcp-field">
      <span className="mcp-field-label">候选模型</span>
      {loading ? (
        <span className="mcp-field-hint">加载中...</span>
      ) : candidates.length === 0 ? (
        <span className="mcp-field-hint candidate-model-empty-hint">请先在模型服务商中添加候选模型</span>
      ) : (
        <select
          className="mcp-field-input"
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="">选择候选模型...</option>
          {candidates.map((c) => (
            <option key={c.id} value={c.id}>
              {c.displayName || c.modelId}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

function useCandidateModels(providerId: string): {
  candidates: CandidateModelView[];
  loading: boolean;
} {
  const [candidates, setCandidates] = useState<CandidateModelView[]>([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!providerId) {
      setCandidates([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    window
      .eco!.listCandidateModels(providerId)
      .then((result) => {
        if (!cancelled) setCandidates(result);
      })
      .catch(() => {
        if (!cancelled) setCandidates([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [providerId]);
  return { candidates, loading };
}

function ThinkingEffortSelect({
  value,
  disabled,
  onChange,
}: {
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label className="mcp-field">
      <span className="mcp-field-label">思考强度</span>
      <select className="mcp-field-input" value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
        <option value="">默认</option>
        <option value="off">关闭</option>
        <option value="low">低</option>
        <option value="medium">中</option>
        <option value="high">高</option>
        <option value="xhigh">极高</option>
        <option value="max">最大</option>
      </select>
    </label>
  );
}

function ApiCompatSelect({
  value,
  disabled,
  onChange,
}: {
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label className="mcp-field">
      <span className="mcp-field-label">API 兼容模式</span>
      <select className="mcp-field-input" value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
        <option value="">默认</option>
        {UPSTREAM_API_COMPAT_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function ProfileNodeCandidateModelFields({
  providerId,
  candidateModelId,
  thinkingEffort,
  apiCompat,
  providers,
  candidates,
  candidatesLoading,
  selectedCandidate,
  busy,
  onProviderChange,
  onCandidateChange,
  onThinkingEffortChange,
  onApiCompatChange,
}: {
  providerId: string;
  candidateModelId: string;
  thinkingEffort: string;
  apiCompat: string;
  providers: ProviderConfigView[];
  candidates: CandidateModelView[];
  candidatesLoading: boolean;
  selectedCandidate?: CandidateModelView;
  busy?: boolean;
  onProviderChange: (providerId: string) => void;
  onCandidateChange: (candidateId: string, modelId: string) => void;
  onThinkingEffortChange: (value: string) => void;
  onApiCompatChange: (value: string) => void;
}) {
  return (
    <div className="profile-node-model-fields">
      <div className="models-agent-template-form-grid">
        <label className="mcp-field">
          <span className="mcp-field-label">模型服务商</span>
          <select
            className="mcp-field-input"
            value={providerId}
            disabled={busy}
            onChange={(event) => onProviderChange(event.target.value)}
          >
            {providers.map((provider) => (
              <option key={provider.id} value={provider.id}>
                {provider.name}
              </option>
            ))}
          </select>
        </label>
        <CandidateModelSelectField
          value={candidateModelId}
          candidates={candidates}
          loading={candidatesLoading}
          {...(busy !== undefined ? { disabled: busy } : {})}
          onChange={(nextCandidateId) => {
            const candidate = candidates.find((entry) => entry.id === nextCandidateId);
            onCandidateChange(nextCandidateId, candidate?.modelId ?? "");
          }}
        />
        <ThinkingEffortSelect
          value={thinkingEffort}
          {...(busy !== undefined ? { disabled: busy } : {})}
          onChange={onThinkingEffortChange}
        />
        <ApiCompatSelect
          value={apiCompat}
          {...(busy !== undefined ? { disabled: busy } : {})}
          onChange={onApiCompatChange}
        />
      </div>
      <CandidateModelSpecPanel {...(selectedCandidate ? { candidate: selectedCandidate } : {})} />
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
  providers,
  busy,
  onClose,
  onPatchProfile,
  onPatchAgent,
  onPatchMainToolPolicy,
}: {
  node: AgentProfileSelectedNode;
  form: AgentProfileFormState;
  agent?: AgentProfileAgentFormState | undefined;
  agentIndex: number;
  template?: AgentTemplate | undefined;
  templates: AgentTemplate[];
  mcpServers: McpServerConfigView[];
  providers: ProviderConfigView[];
  busy?: boolean | undefined;
  onClose: () => void;
  onPatchProfile: (patch: Partial<AgentProfileFormState>) => void;
  onPatchAgent: (index: number, patch: Partial<AgentProfileAgentFormState>) => void;
  onPatchMainToolPolicy: (patch: Parameters<typeof mainCapabilityPatchToProfileForm>[0]) => void;
}) {
  const isMainNode = node.kind === "main";
  const isBuiltinExploreNode = node.kind === "builtinExplore";
  const nodeProviderId = isMainNode
    ? form.mainProviderId
    : isBuiltinExploreNode
      ? form.builtinExploreProviderId
      : (agent?.providerId ?? "");
  const { candidates: nodeCandidates, loading: nodeCandidatesLoading } = useCandidateModels(nodeProviderId);
  const selectedCandidateId = isMainNode
    ? form.mainCandidateModelId
    : isBuiltinExploreNode
      ? form.builtinExploreCandidateModelId
      : (agent?.candidateModelId ?? "");
  const selectedCandidate = nodeCandidates.find((candidate) => candidate.id === selectedCandidateId);
  const nodeTitle = isMainNode
    ? "主 Agent 配置"
    : isBuiltinExploreNode
      ? "Explore 配置"
      : `${template?.name ?? agent?.displayName ?? agent?.agentKey ?? "子代理"} 节点配置`;
  const mainCapabilityOptions = useMemo(
    () =>
      buildAgentTemplateCapabilityOptions({
        templates,
        form: {
          advancedDisallowedTools: form.mainAdvancedDisallowedTools,
          mcpServers: form.mainMcpServers,
          mcpTools: form.mainMcpTools,
        },
        mcpServers,
      }),
    [templates, form.mainAdvancedDisallowedTools, form.mainMcpServers, form.mainMcpTools, mcpServers],
  );
  const agentCapabilityOptions = useMemo(
    () =>
      agent
        ? buildAgentTemplateCapabilityOptions({
            templates,
            form: {
              advancedDisallowedTools: agent.advancedDisallowedTools,
              mcpServers: agent.mcpServers,
              mcpTools: agent.mcpTools,
            },
            mcpServers,
          })
        : { tools: [], mcpServers: [], mcpTools: [] },
    [agent, templates, mcpServers],
  );

  if (!isMainNode && !isBuiltinExploreNode && (!agent || agentIndex < 0)) {
    return null;
  }

  function handleProviderChange(nextProviderId: string, fallbackModelId: string) {
    return {
      providerId: nextProviderId,
      modelId: fallbackModelId,
      candidateModelId: "",
    };
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
              </div>

              <ProfileNodeCandidateModelFields
                providerId={form.mainProviderId}
                candidateModelId={form.mainCandidateModelId}
                thinkingEffort={form.mainThinkingEffort}
                apiCompat={form.mainApiCompat}
                providers={providers}
                candidates={nodeCandidates}
                candidatesLoading={nodeCandidatesLoading}
                {...(selectedCandidate ? { selectedCandidate } : {})}
                {...(busy !== undefined ? { busy } : {})}
                onProviderChange={(nextProviderId) => {
                  const provider = providers.find((entry) => entry.id === nextProviderId);
                  onPatchProfile({
                    mainProviderId: nextProviderId,
                    mainModelId: provider?.defaultModel || form.mainModelId,
                    mainCandidateModelId: "",
                  });
                }}
                onCandidateChange={(candidateId, modelId) =>
                  onPatchProfile({
                    mainCandidateModelId: candidateId,
                    mainModelId: modelId,
                  })
                }
                onThinkingEffortChange={(value) => onPatchProfile({ mainThinkingEffort: value })}
                onApiCompatChange={(value) => onPatchProfile({ mainApiCompat: value })}
              />

              {form.mainSystemPromptPreset === "custom" ? (
                <label className="mcp-field">
                  <span className="mcp-field-label">主 Agent 提示词</span>
                  <textarea
                    className="mcp-field-input mcp-field-textarea models-agent-prompt-textarea"
                    value={form.mainPrompt}
                    disabled={busy}
                    onChange={(event) => onPatchProfile({ mainPrompt: event.target.value })}
                  />
                </label>
              ) : null}
              <ToolCapabilityPanel
                values={mainCapabilityFromProfileForm(form)}
                {...(busy !== undefined ? { disabled: busy } : {})}
                capabilityOptions={mainCapabilityOptions}
                showPresets
                onChange={(patch) => onPatchMainToolPolicy(patch)}
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

              <ProfileNodeCandidateModelFields
                providerId={form.builtinExploreProviderId}
                candidateModelId={form.builtinExploreCandidateModelId}
                thinkingEffort={form.builtinExploreThinkingEffort}
                apiCompat={form.builtinExploreApiCompat}
                providers={providers}
                candidates={nodeCandidates}
                candidatesLoading={nodeCandidatesLoading}
                {...(selectedCandidate ? { selectedCandidate } : {})}
                {...(busy !== undefined ? { busy } : {})}
                onProviderChange={(nextProviderId) => {
                  const provider = providers.find((entry) => entry.id === nextProviderId);
                  onPatchProfile({
                    builtinExploreProviderId: nextProviderId,
                    builtinExploreModelId: provider?.defaultModel || form.builtinExploreModelId,
                    builtinExploreCandidateModelId: "",
                  });
                }}
                onCandidateChange={(candidateId, modelId) =>
                  onPatchProfile({
                    builtinExploreCandidateModelId: candidateId,
                    builtinExploreModelId: modelId,
                  })
                }
                onThinkingEffortChange={(value) => onPatchProfile({ builtinExploreThinkingEffort: value })}
                onApiCompatChange={(value) => onPatchProfile({ builtinExploreApiCompat: value })}
              />

              <AgentThemeColorField
                label="主题色"
                agentKey="explore"
                value={form.builtinExploreThemeColor}
                {...(busy !== undefined ? { disabled: busy } : {})}
                onChange={(value) => onPatchProfile({ builtinExploreThemeColor: value })}
              />
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

              {agent ? (
                <ProfileNodeCandidateModelFields
                  providerId={agent.providerId}
                  candidateModelId={agent.candidateModelId}
                  thinkingEffort={agent.thinkingEffort}
                  apiCompat={agent.apiCompat}
                  providers={providers}
                  candidates={nodeCandidates}
                  candidatesLoading={nodeCandidatesLoading}
                  {...(selectedCandidate ? { selectedCandidate } : {})}
                  {...(busy !== undefined ? { busy } : {})}
                  onProviderChange={(nextProviderId) => {
                    const provider = providers.find((entry) => entry.id === nextProviderId);
                    onPatchAgent(agentIndex, {
                      ...handleProviderChange(nextProviderId, provider?.defaultModel || agent.modelId || ""),
                    });
                  }}
                  onCandidateChange={(candidateId, modelId) =>
                    onPatchAgent(agentIndex, {
                      candidateModelId: candidateId,
                      modelId,
                    })
                  }
                  onThinkingEffortChange={(value) => onPatchAgent(agentIndex, { thinkingEffort: value })}
                  onApiCompatChange={(value) => onPatchAgent(agentIndex, { apiCompat: value })}
                />
              ) : null}

              {agent ? (
                <AgentThemeColorField
                  label="主题色"
                  agentKey={agent.agentKey}
                  value={agent.themeColor}
                  {...(busy !== undefined ? { disabled: busy } : {})}
                  onChange={(value) => onPatchAgent(agentIndex, { themeColor: value })}
                />
              ) : null}

              {agent ? (
                <ToolCapabilityPanel
                  values={{ ...agentCapabilityFromAgentForm(agent), allowDelegation: false }}
                  {...(busy !== undefined ? { disabled: busy } : {})}
                  capabilityOptions={agentCapabilityOptions}
                  showDelegation={false}
                  onChange={(patch) => onPatchAgent(agentIndex, agentCapabilityPatchToAgentForm(patch))}
                />
              ) : null}
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

function ProviderEditorModal({
  form,
  setForm,
  models,
  modelsLoading,
  modelsError,
  modelsDevOptions,
  modelsDevLoading,
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
  modelsDevOptions: readonly ModelsDevModelOption[];
  modelsDevLoading: boolean;
  error?: string | undefined;
  testing?: boolean | undefined;
  busy?: boolean | undefined;
  canDelete: boolean;
  onClose: () => void;
  onSave: () => void | Promise<void>;
  onDelete: () => void;
  onRefreshModels: () => void;
  onTest: () => void;
}) {
  const isEditing = Boolean(form.id);
  const title = isEditing ? `编辑 ${form.name.trim() || "模型服务商"}` : "新建模型服务商";
  const [manualPresetSelected, setManualPresetSelected] = useState(false);
  const [candidatesPanelOpen, setCandidatesPanelOpen] = useState(false);
  const [candidateSaveError, setCandidateSaveError] = useState<string | undefined>(undefined);
  const candidatePanelRef = useRef<CandidateModelPanelHandle>(null);
  const matchingPreset = findMatchingProviderPreset(form);
  const activePreset = manualPresetSelected ? undefined : matchingPreset;

  async function handleSaveProvider() {
    setCandidateSaveError(undefined);
    try {
      if (isEditing && form.id) {
        await candidatePanelRef.current?.savePendingEdits();
      }
      await onSave();
    } catch (caught) {
      setCandidateSaveError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  useEffect(() => {
    if (!isEditing || !form.id) {
      setCandidatesPanelOpen(false);
      return;
    }
    let cancelled = false;
    void window.eco!
      .listCandidateModels(form.id)
      .then((candidates) => {
        if (!cancelled) {
          setCandidatesPanelOpen(candidates.length === 0);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setCandidatesPanelOpen(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [isEditing, form.id]);

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
        className={`settings-modal settings-modal-provider-editor${candidatesPanelOpen ? " is-candidates-open" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="provider-modal-title"
      >
        <header className="settings-modal-header">
          <h2 id="provider-modal-title" className="settings-modal-title">
            {title}
          </h2>
          <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
            {isEditing ? (
              <button
                type="button"
                className={`candidate-panel-toggle${candidatesPanelOpen ? " is-open" : ""}`}
                onClick={() => setCandidatesPanelOpen((v) => !v)}
                aria-expanded={candidatesPanelOpen}
                title={candidatesPanelOpen ? "收起候选模型" : "展开候选模型"}
              >
                <ChevronRight size={14} className="candidate-panel-toggle-icon" aria-hidden />
                候选模型
              </button>
            ) : null}
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
          </div>
        </header>

        <div className="provider-modal-layout">
          <div className="provider-modal-form-main settings-modal-body mcp-editor-form models-editor-form">
            <div className="mcp-field models-provider-preset-field">
              <span className="mcp-field-label">供应商预设</span>
              <select
                className="mcp-field-input"
                value={activePreset?.id ?? ""}
                disabled={busy}
                onChange={(event) => {
                  if (!event.target.value) {
                    setManualPresetSelected(true);
                    return;
                  }
                  const preset = FREE_TOKEN_PROVIDER_PRESETS.find((entry) => entry.id === event.target.value);
                  if (!preset) {
                    return;
                  }
                  setManualPresetSelected(false);
                  setForm((current) => applyProviderPreset(current, preset));
                }}
              >
                <option value="">手动配置</option>
                {FREE_TOKEN_PROVIDER_PRESETS.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {formatProviderPresetSelectLabel(preset)}
                  </option>
                ))}
              </select>
            </div>

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
              <span className="models-provider-label-row">
                <span className="mcp-field-label">API key</span>
                {activePreset ? (
                  <a
                    className="models-provider-inline-link"
                    href={activePreset.apiKeyUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <LinkIcon size={12} />
                    注册 / 创建 Key
                  </a>
                ) : null}
              </span>
              <input
                className="mcp-field-input"
                type="password"
                value={form.apiKey ?? ""}
                placeholder={form.id ? "留空则保留已保存的 Key" : "可选，本地 Ollama 等可留空"}
                onChange={(event) => setForm((current) => ({ ...current, apiKey: event.target.value }))}
              />
            </label>

            <label className="mcp-field models-toggle-field">
              <span className="mcp-field-label">启用此模型服务商</span>
              <label className="mcp-toggle mcp-toggle-sm" title={form.enabled ? "已启用" : "已禁用"}>
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
                disabled={busy || testing || !form.baseUrl.trim()}
                onClick={onTest}
              >
                <RefreshCw size={16} className={testing ? "model-refresh-spin" : undefined} />
                测试连接
              </button>
            </div>

            {error && <p className="settings-form-error">{error}</p>}
            {candidateSaveError ? (
              <p className="settings-form-error">{candidateSaveError}</p>
            ) : null}
          </div>

          {isEditing && form.id ? (
            <CandidateModelPanel
              ref={candidatePanelRef}
              providerId={form.id}
              models={models}
              modelsLoading={modelsLoading}
              modelsDevOptions={modelsDevOptions}
              modelsDevLoading={modelsDevLoading}
              busy={busy}
              onRefreshModels={onRefreshModels}
            />
          ) : null}
        </div>

        <footer className="settings-modal-footer settings-modal-footer-split">
          {isEditing ? (
            <button
              type="button"
              className="mcp-uninstall-button"
              onClick={onDelete}
              disabled={busy || !canDelete}
              title={canDelete ? undefined : "至少保留一个模型服务商"}
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
            <button
              type="button"
              className="mcp-save-button"
              disabled={busy}
              onClick={() => void handleSaveProvider()}
            >
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
              <span>默认智能体配置</span>
              <p>{primaryExample?.title ?? preset.modelSuggestion.main}</p>
            </div>

            <div className="models-preset-footer">
              <span className="models-preset-model-suggestion">{preset.modelSuggestion.main}</span>
              <button
                type="button"
                className="models-section-button"
                disabled={busy}
                onClick={() => onCopyPreset(preset)}
                title={`从 ${formatAgentDomainLabel(preset.id)} 创建智能体配置`}
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
