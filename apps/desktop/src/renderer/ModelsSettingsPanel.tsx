import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  ChevronDown,
  ChevronRight,
  Eraser,
  Globe2,
  LinkIcon,
  Plus,
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
import { useTranslation } from "react-i18next";
import { isOpenAICompat } from "../shared/api-compat";
import type {
  AuxiliaryModelSelection,
  CandidateModelView,
  CommitModelOptionView,
  McpServerConfigView,
  ModelSettingsSnapshot,
  ModelsDevModelOption,
  OrchestrationSelection,
  ProviderConfigInput,
  ProviderConfigView,
  ProviderDeleteReference,
  ProviderRequestError,
  ProxyBridgeSettingsSnapshot,
  SkillsListResult,
  VisionModelSelection,
} from "../shared/ipc";
import { ROUTE_TEST_THINKING_EFFORT, type UpstreamModelOption } from "../shared/models";
import { hasCompleteOrchestrationSelection } from "../shared/thread-runtime-config";
import { ApiCompatToggle } from "./ApiCompatToggle";
import { AppMessage, type AppMessageKind, formatDurationMs } from "./AppMessage";
import { buildAgentTemplateCapabilityOptions } from "./agent-template-form";
import { AgentThemeColorField } from "./agent-theme-color-field";
import { CandidateModelPanel, type CandidateModelPanelHandle } from "./CandidateModelListSection";
import { CandidateModelSpecPanel } from "./ModelSpecSummary";
import { ProxyBridgeSettingsSection } from "./ProxyBridgeSettingsSection";
import {
  applyProviderPreset,
  FREE_TOKEN_PROVIDER_PRESETS,
  findMatchingProviderPreset,
  formatProviderPresetSelectLabel,
} from "./provider-presets";
import { SubagentSettingsSection } from "./SubagentSettingsSection";
import { AgentCompositionResourcesSection } from "./AgentCompositionResourcesSection";
import { ToolCapabilityPanel } from "./ToolCapabilityPanel";
import {
  createCommitModelPricingExtra,
  mapCommitModelOptions,
  toCandidateModelSelection,
  toModelCascadeSelection,
} from "./model-cascade-options";
import { ModelCascadeSelect } from "./ModelCascadeSelect";
import { ComposerFieldSelect } from "./ComposerFieldSelect";

export type ModelsSettingsTab =
  | "subagents"
  | "providers"
  | "proxyBridge"
  | "compositionParts";

type RuntimeConfigTab = "defaults" | "mainConfig" | "prompt" | "orchestration";

interface ModelsSettingsPanelProps {
  settings: ModelSettingsSnapshot;
  proxyBridgeSettings: ProxyBridgeSettingsSnapshot;
  mcpServers?: McpServerConfigView[] | undefined;
  skillsSnapshot?: SkillsListResult | undefined;
  proxyBridgeSettingsSaving?: boolean | undefined;
  busy?: boolean | undefined;
  initialTab?: ModelsSettingsTab | undefined;
  mode?: "agentBuilder" | "providerSettings" | undefined;
  hideCategoryTabs?: boolean | undefined;
  heading?: string | undefined;
  onSettingsChange: (settings: ModelSettingsSnapshot) => void;
  defaultOrchestrationSelection?: OrchestrationSelection | undefined;
  onDefaultOrchestrationSelectionChange?:
    | ((selection: OrchestrationSelection | undefined) => void | Promise<void>)
    | undefined;
  defaultAuxiliaryModel?: AuxiliaryModelSelection | undefined;
  onDefaultAuxiliaryModelChange?:
    | ((selection: AuxiliaryModelSelection | undefined) => void | Promise<void>)
    | undefined;
  defaultVisionModel?: VisionModelSelection | undefined;
  onDefaultVisionModelChange?:
    | ((selection: VisionModelSelection | undefined) => void | Promise<void>)
    | undefined;
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
  hideCategoryTabs = false,
  heading,
  onSettingsChange,
  defaultOrchestrationSelection,
  onDefaultOrchestrationSelectionChange,
  defaultAuxiliaryModel,
  onDefaultAuxiliaryModelChange,
  defaultVisionModel,
  onDefaultVisionModelChange,
  onProxyBridgeSettingsChange,
  onSavingChange,
}: ModelsSettingsPanelProps) {
  const { t } = useTranslation();
  const providerSettingsTabItems: Array<{ id: ModelsSettingsTab; label: string }> = [
    { id: "providers", label: t("settings.models.providers") },
    { id: "proxyBridge", label: t("settings.models.proxyBridge") },
  ];
  const runtimeConfigTabItems: Array<{ id: RuntimeConfigTab; label: string }> = [
    { id: "defaults", label: t("settings.models.runtimeConfigTab.defaults") },
    { id: "mainConfig", label: t("settings.models.runtimeConfigTab.mainAgent") },
    { id: "prompt", label: t("settings.models.runtimeConfigTab.prompt") },
    { id: "orchestration", label: t("settings.models.runtimeConfigTab.subagent") },
  ];
  const resolvedInitialTab =
    mode === "providerSettings"
      ? initialTab === "proxyBridge"
        ? "proxyBridge"
        : "providers"
      : initialTab === "providers" || initialTab === "proxyBridge"
        ? "subagents"
        : initialTab;
  const [activeTab, setActiveTab] = useState<ModelsSettingsTab>(resolvedInitialTab);
  const [runtimeConfigTab, setRuntimeConfigTab] = useState<RuntimeConfigTab>("defaults");
  const [providerModalOpen, setProviderModalOpen] = useState(false);
  const [providerForm, setProviderForm] = useState<ProviderConfigInput>(() => providerToForm());
  const [modelsCache, setModelsCache] = useState<Record<string, ModelsCacheEntry>>({});
  const [loadingProviderId, setLoadingProviderId] = useState<string | null>(null);
  const [panelError, setPanelError] = useState<string>();
  const [defaultOrchestrationDraft, setDefaultOrchestrationDraft] =
    useState<OrchestrationSelection>(
      () =>
        defaultOrchestrationSelection ?? {
          mainAgentConfigId: "",
          mainPrompt: { mode: "builtin" },
          subagents: { mode: "none" },
        },
    );
  const [auxiliaryModelOptions, setAuxiliaryModelOptions] = useState<CommitModelOptionView[]>([]);
  const [auxiliaryModelsLoading, setAuxiliaryModelsLoading] = useState(false);
  const [auxiliaryModelsError, setAuxiliaryModelsError] = useState<string>();
  const commitModelPricingExtra = useMemo(
    () => createCommitModelPricingExtra(auxiliaryModelOptions),
    [auxiliaryModelOptions],
  );

  useEffect(() => {
    setDefaultOrchestrationDraft(
      defaultOrchestrationSelection ?? {
        mainAgentConfigId: "",
        mainPrompt: { mode: "builtin" },
        subagents: { mode: "none" },
      },
    );
  }, [defaultOrchestrationSelection]);

  const updateDefaultOrchestrationDraft = useCallback(
    (patch: Partial<OrchestrationSelection>) => {
      const next: OrchestrationSelection = {
        mainAgentConfigId:
          patch.mainAgentConfigId ?? defaultOrchestrationDraft.mainAgentConfigId,
        mainPrompt: patch.mainPrompt ?? defaultOrchestrationDraft.mainPrompt,
        subagents: patch.subagents ?? defaultOrchestrationDraft.subagents,
      };
      setDefaultOrchestrationDraft(next);
      if (hasCompleteOrchestrationSelection(next)) {
        void Promise.resolve(onDefaultOrchestrationSelectionChange?.(next)).catch((error) => {
          setPanelError(error instanceof Error ? error.message : String(error));
        });
      }
    },
    [defaultOrchestrationDraft, onDefaultOrchestrationSelectionChange],
  );

  const auxiliaryModelLookupId =
    settings.mainAgentConfigs.some(
      (config) => config.id === defaultOrchestrationDraft.mainAgentConfigId,
    )
      ? defaultOrchestrationDraft.mainAgentConfigId
      : (settings.mainAgentConfigs[0]?.id ?? "");

  useEffect(() => {
    if (!window.eco?.listGitCommitModelOptions) {
      setAuxiliaryModelOptions([]);
      setAuxiliaryModelsLoading(false);
      setAuxiliaryModelsError(undefined);
      return;
    }
    let cancelled = false;
    setAuxiliaryModelsLoading(true);
    setAuxiliaryModelsError(undefined);
    void window.eco
      .listGitCommitModelOptions(
        auxiliaryModelLookupId ? { mainAgentConfigId: auxiliaryModelLookupId } : {},
      )
      .then((result) => {
        if (!cancelled) {
          setAuxiliaryModelOptions(result.options);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setAuxiliaryModelOptions([]);
          setAuxiliaryModelsError(error instanceof Error ? error.message : String(error));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setAuxiliaryModelsLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [auxiliaryModelLookupId]);

  const selectDefaultAuxiliaryModel = useCallback(
    (selection: AuxiliaryModelSelection | undefined) => {
      void Promise.resolve(onDefaultAuxiliaryModelChange?.(selection)).catch((error) => {
        setPanelError(error instanceof Error ? error.message : String(error));
      });
    },
    [onDefaultAuxiliaryModelChange],
  );
  const selectDefaultVisionModel = useCallback(
    (selection: VisionModelSelection | undefined) => {
      void Promise.resolve(onDefaultVisionModelChange?.(selection)).catch((error) => {
        setPanelError(error instanceof Error ? error.message : String(error));
      });
    },
    [onDefaultVisionModelChange],
  );
  const [modalError, setModalError] = useState<string>();
  const [testingProviderKey, setTestingProviderKey] = useState<string | null>(null);
  const [providerTestMessage, setProviderTestMessage] = useState<{
    kind: AppMessageKind;
    message: string;
  }>();
  const [modelsDevOptions, setModelsDevOptions] = useState<ModelsDevModelOption[]>([]);
  const [modelsDevLoading, setModelsDevLoading] = useState(false);

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
        ...(target.version !== undefined && target.version !== ""
          ? { version: target.version }
          : {}),
        ...(target.apiCompat && { apiCompat: target.apiCompat }),
        ...(target.id && { providerId: target.id }),
        ...(target.apiKey && { apiKey: target.apiKey }),
      };
      const result = await window.eco.listProviderModels(request);
      if (!result.ok) {
        const error = localizeProviderRequestError(result, t);
        setModelsCache((current) => ({
          ...current,
          [cacheKey]: { models: current[cacheKey]?.models ?? [], error },
        }));
        if (!options?.silent) {
          setModalError(error);
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

  async function saveProvider(options?: { closeOnSuccess?: boolean }) {
    if (!window.eco) {
      return undefined;
    }
    const closeOnSuccess = options?.closeOnSuccess ?? Boolean(providerForm.id);
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
      // Keep editor open after first create so candidate models can be added/tested immediately.
      setProviderForm(providerToForm(provider));
      if (closeOnSuccess) {
        closeProviderModal();
      }
      return provider;
    } catch (caught) {
      setModalError(caught instanceof Error ? caught.message : String(caught));
      return undefined;
    } finally {
      onSavingChange?.(false);
    }
  }

  async function deleteProvider() {
    if (!window.eco || !providerForm.id) {
      return;
    }
    const providerName = providerForm.name.trim() || t("settings.models.providerFallback");
    if (!window.confirm(t("settings.models.confirmDeleteProvider", { name: providerName }))) {
      return;
    }

    const deletedId = providerForm.id;
    setModalError(undefined);
    onSavingChange?.(true);
    try {
      const result = await window.eco.deleteProvider(deletedId);
      if (!result.ok) {
        if (result.reason === "not_found") {
          setModalError(t("settings.models.providerDeleteNotFound"));
          await refreshSettings();
          return;
        }
        setModalError(
          t("settings.models.providerDeleteInUse", {
            references: result.references
              .map((reference) => formatProviderDeleteReference(reference, t))
              .join(t("settings.models.providerDeleteReferenceSeparator")),
          }),
        );
        return;
      }
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

  async function testProvider(target: ProviderConfigInput, modelId?: string) {
    if (!window.eco?.testProviderConnection) {
      return;
    }
    const providerName = target.name.trim() || t("settings.models.providerFallback");
    if (!target.baseUrl.trim()) {
      showProviderTestMessage("error", t("settings.models.baseUrlRequired"));
      return;
    }
    const testModel = (modelId ?? target.defaultModel).trim();
    if (!testModel) {
      showProviderTestMessage("error", t("settings.models.testModelRequired"));
      return;
    }

    const feedbackKey = modelId?.trim()
      ? `${target.id ?? "__draft__"}::${testModel}`
      : (target.id ?? "__draft__");
    setTestingProviderKey(feedbackKey);

    const startedAt = performance.now();
    try {
      const result = await window.eco.testProviderConnection({
        baseUrl: target.baseUrl,
        ...(target.requestPath !== undefined && { requestPath: target.requestPath }),
        ...(target.version !== undefined && { version: target.version }),
        ...(target.apiCompat && { apiCompat: target.apiCompat }),
        defaultModel: testModel,
        thinkingEffort: ROUTE_TEST_THINKING_EFFORT,
        ...(target.id && { providerId: target.id }),
        ...(target.apiKey && { apiKey: target.apiKey }),
      });
      if (result.ok) {
        const duration = formatDurationMs(performance.now() - startedAt);
        showProviderTestMessage(
          "success",
          t("settings.models.providerTestPassed", {
            provider: providerName,
            model: testModel,
            duration,
          }),
        );
      } else {
        showProviderTestMessage("error", localizeProviderRequestError(result, t));
      }
    } catch (caught) {
      showProviderTestMessage("error", caught instanceof Error ? caught.message : String(caught));
    } finally {
      setTestingProviderKey(null);
    }
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
      {mode === "providerSettings" ? (
        <header className="mcp-page-header">
          <h1>{t("settings.models.providers")}</h1>
        </header>
      ) : (
        <header className="settings-page-header">
          <h1>{heading ?? t("settings.agentLibrary")}</h1>
        </header>
      )}

      {!hideCategoryTabs && (
        <div
          className="models-settings-tabs"
          role="tablist"
            aria-label={t("settings.models.providerCategories")}
        >
          {providerSettingsTabItems.map((tab) => (
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
      )}

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
        <section className="mcp-list-section providers-list-section">
          <div className="mcp-list-toolbar">
            <span className="mcp-list-toolbar-label">{t("settings.models.providers")}</span>
            <button type="button" className="mcp-add-button" disabled={busy} onClick={openCreateProvider}>
              <Plus size={16} />
              {t("settings.models.addProvider")}
            </button>
          </div>

          {providerOptions.length === 0 ? (
            <p className="mcp-list-empty">{t("settings.models.noProviders")}</p>
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
                      aria-label={t("settings.models.configureProvider", { name: provider.name })}
                      disabled={busy}
                    >
                      <Settings2 size={18} />
                    </button>
                    <label
                      className="mcp-toggle mcp-toggle-sm"
                      title={provider.enabled ? t("common.enabled") : t("common.disabled")}
                    >
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

      {activeTab === "compositionParts" && (
        <>
          <div
            className="models-settings-tabs"
            role="tablist"
            aria-label={t("settings.models.runtimeConfigCategories")}
          >
            {runtimeConfigTabItems.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={runtimeConfigTab === tab.id}
                className={
                  runtimeConfigTab === tab.id ? "models-settings-tab active" : "models-settings-tab"
                }
                onClick={() => setRuntimeConfigTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {runtimeConfigTab === "defaults" ? (
          <section className="settings-global-orchestration">
            <div className="settings-global-orchestration-header">
              <div className="settings-global-orchestration-heading">
                <span className="settings-global-orchestration-icon" aria-hidden>
                  <Globe2 size={18} strokeWidth={1.8} />
                </span>
                <div>
                  <h3>{t("settings.models.resources.globalOrchestration")}</h3>
                  <p>{t("settings.models.resources.globalOrchestrationHint")}</p>
                </div>
              </div>
              <button
                type="button"
                className="settings-global-orchestration-reset"
                title={t("settings.models.resources.clearGlobalOrchestration")}
                aria-label={t("settings.models.resources.clearGlobalOrchestration")}
                disabled={busy || !defaultOrchestrationSelection}
                onClick={() => {
                  setDefaultOrchestrationDraft({
                    mainAgentConfigId: "",
                    mainPrompt: { mode: "builtin" },
                    subagents: { mode: "none" },
                  });
                  void Promise.resolve(onDefaultOrchestrationSelectionChange?.(undefined)).catch(
                    (error) => {
                      setPanelError(error instanceof Error ? error.message : String(error));
                    },
                  );
                }}
              >
                <Eraser size={17} aria-hidden />
              </button>
            </div>
            <div className="settings-global-orchestration-list">
              <label className="settings-global-orchestration-row">
                <span className="settings-global-orchestration-label">
                  {t("composer.route.mainAgent")}
                </span>
                <ComposerFieldSelect
                  value={defaultOrchestrationDraft.mainAgentConfigId.trim()}
                  disabled={busy || settings.mainAgentConfigs.length === 0}
                  showPlaceholder
                  placeholder={t("composer.route.notConfigured")}
                  invalid={
                    Boolean(defaultOrchestrationDraft.mainAgentConfigId.trim()) &&
                    !settings.mainAgentConfigs.some(
                      (config) => config.id === defaultOrchestrationDraft.mainAgentConfigId,
                    )
                  }
                  invalidLabel={t("settings.models.resources.missingMainAgentHint")}
                  onChange={(value) =>
                    updateDefaultOrchestrationDraft({ mainAgentConfigId: value })
                  }
                >
                  {Boolean(defaultOrchestrationDraft.mainAgentConfigId.trim()) &&
                  !settings.mainAgentConfigs.some(
                    (config) => config.id === defaultOrchestrationDraft.mainAgentConfigId,
                  ) ? (
                    <option value={defaultOrchestrationDraft.mainAgentConfigId}>
                      {t("settings.models.resources.missingMainAgentOption", {
                        id: defaultOrchestrationDraft.mainAgentConfigId,
                      })}
                    </option>
                  ) : null}
                  {settings.mainAgentConfigs.map((config) => (
                    <option key={config.id} value={config.id}>
                      {config.name} ({config.modelRef.modelId})
                    </option>
                  ))}
                </ComposerFieldSelect>
              </label>
              <label className="settings-global-orchestration-row settings-global-orchestration-row-with-hint">
                <span className="settings-global-orchestration-label">
                  {t("composer.route.auxiliaryModel")}
                  <span className="settings-global-orchestration-hint">
                    {t("composer.route.auxiliaryModelHint")}
                  </span>
                </span>
                <ModelCascadeSelect
                  value={toModelCascadeSelection(defaultAuxiliaryModel)}
                  options={mapCommitModelOptions(auxiliaryModelOptions)}
                  loading={auxiliaryModelsLoading}
                  error={auxiliaryModelsError}
                  disabled={busy}
                  clearable
                  hint={t("composer.route.auxiliaryModelHint")}
                  placeholder={t("composer.route.auxiliaryModel")}
                  renderExtra={commitModelPricingExtra}
                  onChange={(selection) => selectDefaultAuxiliaryModel(selection ? toCandidateModelSelection(selection) : undefined)}
                />
              </label>
              <label className="settings-global-orchestration-row settings-global-orchestration-row-with-hint">
                <span className="settings-global-orchestration-label">
                  {t("composer.route.visionModel")}
                  <span className="settings-global-orchestration-hint">
                    {t("composer.route.visionModelHint")}
                  </span>
                </span>
                <ModelCascadeSelect
                  value={toModelCascadeSelection(defaultVisionModel)}
                  options={mapCommitModelOptions(auxiliaryModelOptions)}
                  loading={auxiliaryModelsLoading}
                  error={auxiliaryModelsError}
                  disabled={busy}
                  clearable
                  hint={t("composer.route.visionModelHint")}
                  placeholder={t("composer.route.visionModel")}
                  renderExtra={commitModelPricingExtra}
                  onChange={(selection) => selectDefaultVisionModel(selection ? toCandidateModelSelection(selection) : undefined)}
                />
              </label>
              <label className="settings-global-orchestration-row">
                <span className="settings-global-orchestration-label">
                  {t("composer.route.prompt")}
                </span>
                <ComposerFieldSelect
                  value={
                    defaultOrchestrationDraft.mainPrompt.mode === "builtin"
                      ? "__builtin__"
                      : defaultOrchestrationDraft.mainPrompt.promptId
                  }
                  disabled={busy}
                  onChange={(value) =>
                    updateDefaultOrchestrationDraft({
                      mainPrompt:
                        value === "__builtin__"
                          ? { mode: "builtin" }
                          : { mode: "custom_append", promptId: value },
                    })
                  }
                >
                  <option value="__builtin__">{t("composer.route.defaultBuiltinPrompt")}</option>
                  {settings.mainAgentPrompts
                    .filter((prompt) => prompt.mode === "custom_append")
                    .map((prompt) => (
                      <option key={prompt.id} value={prompt.id}>
                        {prompt.name}
                      </option>
                    ))}
                </ComposerFieldSelect>
              </label>
              <label className="settings-global-orchestration-row">
                <span className="settings-global-orchestration-label">
                  {t("composer.route.subagentOrchestration")}
                </span>
                <ComposerFieldSelect
                  value={
                    defaultOrchestrationDraft.subagents.mode === "none"
                      ? "__none__"
                      : defaultOrchestrationDraft.subagents.orchestrationId
                  }
                  disabled={busy}
                  onChange={(value) =>
                    updateDefaultOrchestrationDraft({
                      subagents:
                        value === "__none__"
                          ? { mode: "none" }
                          : { mode: "orchestration", orchestrationId: value },
                    })
                  }
                >
                  <option value="__none__">{t("composer.route.noSubagents")}</option>
                  {settings.subagentOrchestrations.map((orchestration) => (
                    <option key={orchestration.id} value={orchestration.id}>
                      {orchestration.name} ({orchestration.agents.length})
                    </option>
                  ))}
                </ComposerFieldSelect>
              </label>
            </div>
          </section>
          ) : (
          <AgentCompositionResourcesSection
            settings={settings}
            mcpServers={mcpServers}
            busy={busy}
            activeScope={runtimeConfigTab}
            onRegistryChange={refreshSettings}
            onSavingChange={onSavingChange}
            onErrorMessage={(message: string) => showProviderTestMessage("error", message)}
          />
          )}
        </>
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
          testingModelKey={testingProviderKey}
          busy={busy}
          onClose={closeProviderModal}
          onSave={(options) => saveProvider(options)}
          onDelete={() => void deleteProvider()}
          onRefreshModels={() => void fetchModels(providerForm)}
          onTestCandidate={(modelId) => void testProvider(providerForm, modelId)}
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
  modelsDevOptions,
  modelsDevLoading,
  error,
  testingModelKey,
  busy,
  onClose,
  onSave,
  onDelete,
  onRefreshModels,
  onTestCandidate,
}: {
  form: ProviderConfigInput;
  setForm: Dispatch<SetStateAction<ProviderConfigInput>>;
  models: UpstreamModelOption[];
  modelsLoading: boolean;
  modelsError?: string | undefined;
  modelsDevOptions: readonly ModelsDevModelOption[];
  modelsDevLoading: boolean;
  error?: string | undefined;
  testingModelKey?: string | null | undefined;
  busy?: boolean | undefined;
  onClose: () => void;
  onSave: (options?: { closeOnSuccess?: boolean }) => void | Promise<ProviderConfigView | undefined>;
  onDelete: () => void;
  onRefreshModels: () => void;
  onTestCandidate: (modelId: string) => void;
}) {
  const { t } = useTranslation();
  const isEditing = Boolean(form.id);
  const title = isEditing
    ? t("settings.models.provider.editTitle", {
        name: form.name.trim() || t("settings.models.providerFallback"),
      })
    : t("settings.models.provider.createTitle");
  const [manualPresetSelected, setManualPresetSelected] = useState(false);
  // Editing starts with the candidate panel visible; creating starts form-only
  // and reveals the panel right after the first save.
  const [candidatesPanelOpen, setCandidatesPanelOpen] = useState(() => Boolean(form.id));
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [candidateSaveError, setCandidateSaveError] = useState<string | undefined>(undefined);
  const candidatePanelRef = useRef<CandidateModelPanelHandle>(null);
  const prefersReducedMotion = useReducedMotion();
  const matchingPreset = findMatchingProviderPreset(form);
  const activePreset = manualPresetSelected ? undefined : matchingPreset;
  const apiCompat = form.apiCompat ?? "anthropic";
  const modelsErrorMessage = modelsError
    ? t("settings.models.provider.modelsFailed", { detail: modelsError })
    : undefined;
  const formError = modelsErrorMessage ?? error ?? candidateSaveError;

  async function handleSaveProvider() {
    setCandidateSaveError(undefined);
    try {
      if (isEditing && form.id) {
        await candidatePanelRef.current?.savePendingEdits();
      }
      // On create: save and stay open so candidate models can be added immediately.
      // On edit: save and close.
      await onSave({ closeOnSuccess: isEditing });
    } catch (caught) {
      setCandidateSaveError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  useEffect(() => {
    // Candidate models are the primary place to pick/test models —
    // reveal the panel as soon as a provider exists (edit, or right after first save).
    if (form.id) {
      setCandidatesPanelOpen(true);
    }
  }, [form.id]);

  return (
    <div className="settings-modal-backdrop">
      <button
        type="button"
        className="settings-modal-backdrop-close"
        onClick={onClose}
        aria-label={t("common.close")}
        title={t("common.close")}
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
          <div className="settings-modal-header-actions">
            {form.id ? (
              <button
                type="button"
                className={`candidate-panel-toggle${candidatesPanelOpen ? " is-open" : ""}`}
                onClick={() => setCandidatesPanelOpen((v) => !v)}
                aria-expanded={candidatesPanelOpen}
                title={
                  candidatesPanelOpen
                    ? t("settings.models.provider.collapseCandidates")
                    : t("settings.models.provider.expandCandidates")
                }
              >
                <ChevronRight size={14} className="candidate-panel-toggle-icon" aria-hidden />
                {t("settings.models.candidateModels")}
              </button>
            ) : null}
            <button
              type="button"
              className="mcp-icon-button"
              onClick={onClose}
              aria-label={t("common.close")}
              title={t("common.close")}
              disabled={busy}
            >
              <X size={18} />
            </button>
          </div>
        </header>

        <div className="provider-modal-layout">
          <div className="provider-modal-form-main settings-modal-body mcp-editor-form models-editor-form">
            <section className="provider-form-section">
              <h3 className="provider-form-section-title">
                {t("settings.models.provider.basicInfo")}
              </h3>
              <div className="provider-form-grid">
                <div className="mcp-field models-provider-preset-field">
                  <span className="mcp-field-label">{t("settings.models.provider.preset")}</span>
                  <select
                    className="mcp-field-input"
                    value={activePreset?.id ?? ""}
                    disabled={busy}
                    onChange={(event) => {
                      if (!event.target.value) {
                        setManualPresetSelected(true);
                        return;
                      }
                      const preset = FREE_TOKEN_PROVIDER_PRESETS.find(
                        (entry) => entry.id === event.target.value,
                      );
                      if (!preset) {
                        return;
                      }
                      setManualPresetSelected(false);
                      setForm((current) => applyProviderPreset(current, preset));
                    }}
                  >
                    <option value="">{t("settings.models.provider.manual")}</option>
                    {FREE_TOKEN_PROVIDER_PRESETS.map((preset) => (
                      <option key={preset.id} value={preset.id}>
                        {formatProviderPresetSelectLabel(preset)}
                      </option>
                    ))}
                  </select>
                </div>

                <label className="mcp-field">
                  <span className="mcp-field-label">{t("settings.models.provider.name")}</span>
                  <input
                    className="mcp-field-input"
                    value={form.name}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, name: event.target.value }))
                    }
                  />
                </label>
              </div>

              <label className="mcp-field models-toggle-field provider-enable-row">
                <span className="mcp-field-label">{t("settings.models.provider.enable")}</span>
                <label
                  className="mcp-toggle mcp-toggle-sm"
                  title={form.enabled ? t("common.enabled") : t("common.disabled")}
                >
                  <input
                    type="checkbox"
                    checked={form.enabled}
                    disabled={busy}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, enabled: event.target.checked }))
                    }
                  />
                  <span className="mcp-toggle-track" aria-hidden />
                </label>
              </label>
            </section>

            <section className="provider-form-section">
              <h3 className="provider-form-section-title">
                {t("settings.models.provider.connection")}
              </h3>
              <label className="mcp-field">
                <span className="mcp-field-label">baseURL</span>
                <input
                  className="mcp-field-input"
                  value={form.baseUrl}
                  placeholder="https://api.deepseek.com"
                  onChange={(event) =>
                    setForm((current) => ({ ...current, baseUrl: event.target.value }))
                  }
                />
                <span className="mcp-field-hint">{t("settings.models.provider.rootHint")}</span>
              </label>

              <div className="mcp-field models-provider-endpoint-row">
                <span className="mcp-field-label">{t("settings.models.provider.endpoint")}</span>
                <div className="models-provider-endpoint-inline">
                  <ApiCompatToggle
                    value={apiCompat}
                    onChange={(apiCompat) => setForm((current) => ({ ...current, apiCompat }))}
                    disabled={busy}
                  />
                  <span className="models-route-title-sep" aria-hidden>
                    ·
                  </span>
                  <input
                    className="mcp-field-input models-provider-request-path-input"
                    value={form.requestPath ?? ""}
                    placeholder={isOpenAICompat(apiCompat) ? "/zen" : "/anthropic"}
                    disabled={busy}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, requestPath: event.target.value }))
                    }
                  />
                </div>
                <span className="mcp-field-hint">
                  {isOpenAICompat(apiCompat)
                    ? t("settings.models.provider.openAiPathHint")
                    : t("settings.models.provider.anthropicPathHint")}
                </span>
              </div>

              <label className="mcp-field">
                <span className="mcp-field-label">{t("settings.models.provider.version")}</span>
                <input
                  className="mcp-field-input"
                  value={form.version ?? "v1"}
                  placeholder="v1"
                  disabled={busy}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, version: event.target.value }))
                  }
                />
                <span className="mcp-field-hint">{t("settings.models.provider.versionHint")}</span>
              </label>

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
                      {t("settings.models.provider.createKey")}
                    </a>
                  ) : null}
                </span>
                <input
                  className="mcp-field-input"
                  type="password"
                  value={form.apiKey ?? ""}
                  placeholder={
                    form.id
                      ? t("settings.models.provider.keepKey")
                      : t("settings.models.provider.optionalKey")
                  }
                  onChange={(event) =>
                    setForm((current) => ({ ...current, apiKey: event.target.value }))
                  }
                />
              </label>
            </section>

            <section className="provider-form-section provider-advanced-section">
              <button
                type="button"
                className="provider-advanced-toggle"
                aria-expanded={advancedOpen}
                aria-controls="provider-advanced-body"
                onClick={() => setAdvancedOpen((v) => !v)}
              >
                <span>{t("settings.models.provider.advanced")}</span>
                <ChevronDown size={15} className="provider-advanced-toggle-icon" aria-hidden />
              </button>
              <AnimatePresence initial={false}>
                {advancedOpen ? (
                  <motion.div
                    key="provider-advanced-body"
                    id="provider-advanced-body"
                    className="provider-advanced-body"
                    initial={prefersReducedMotion ? false : { height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={
                      prefersReducedMotion
                        ? { duration: 0 }
                        : { type: "spring", bounce: 0, duration: 0.34 }
                    }
                  >
                    <label className="mcp-field">
                      <span className="mcp-field-label">
                        {t("settings.models.provider.tokenCountMode")}
                      </span>
                      <select
                        className="mcp-field-input"
                        value={form.tokenCountMode ?? "local_heuristic"}
                        disabled={busy}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            tokenCountMode: event.target
                              .value as NonNullable<ProviderConfigInput["tokenCountMode"]>,
                          }))
                        }
                      >
                        <option value="local_heuristic">
                          {t("settings.models.provider.localHeuristic")}
                        </option>
                        <option value="anthropic_messages">
                          {t("settings.models.provider.anthropicCount")}
                        </option>
                        <option value="openai_responses">OpenAI /v1/responses/input_tokens</option>
                        <option value="llama_tokenize">llama.cpp /apply-template + /tokenize</option>
                      </select>
                      <span className="mcp-field-hint">
                        {t("settings.models.provider.tokenCountHint")}
                      </span>
                    </label>
                  </motion.div>
                ) : null}
              </AnimatePresence>
            </section>

            {formError ? (
              <div className="provider-form-error" role="alert">
                {formError}
              </div>
            ) : null}
          </div>

          {/* Keep the panel mounted once a provider exists: collapsing only hides it,
              so in-progress candidate edits survive and save on submit. */}
          {form.id ? (
            <CandidateModelPanel
              ref={candidatePanelRef}
              providerId={form.id}
              models={models}
              modelsLoading={modelsLoading}
              modelsDevOptions={modelsDevOptions}
              modelsDevLoading={modelsDevLoading}
              busy={busy}
              testingModelKey={testingModelKey}
              onRefreshModels={onRefreshModels}
              onTestModel={onTestCandidate}
            />
          ) : null}
        </div>

        <footer className="settings-modal-footer settings-modal-footer-split">
          {isEditing ? (
            <button
              type="button"
              className="mcp-uninstall-button"
              onClick={onDelete}
              disabled={busy}
            >
              <Trash2 size={16} />
              {t("common.delete")}
            </button>
          ) : (
            <span />
          )}
          <div className="settings-modal-footer-actions">
            <button
              type="button"
              className="settings-modal-cancel"
              onClick={onClose}
              disabled={busy}
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              className="mcp-save-button"
              disabled={busy}
              onClick={() => void handleSaveProvider()}
            >
              {isEditing ? t("common.save") : t("settings.models.provider.saveAndAdd")}
            </button>
          </div>
        </footer>
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

function formatProviderDeleteReference(
  reference: ProviderDeleteReference,
  t: ReturnType<typeof useTranslation>["t"],
): string {
  const key = {
    route_profile: "settings.models.providerDeleteReference.routeProfile",
    main_agent_config: "settings.models.providerDeleteReference.mainAgentConfig",
    subagent_orchestration: "settings.models.providerDeleteReference.subagentOrchestration",
    active_thread: "settings.models.providerDeleteReference.activeThread",
  }[reference.kind];
  return t(key, { name: reference.name });
}

function localizeProviderRequestError(
  error: ProviderRequestError,
  t: ReturnType<typeof useTranslation>["t"],
): string {
  switch (error.errorCode) {
    case "provider_not_found":
      return t("settings.models.providerNotFound", {
        id: error.providerId || t("settings.models.providerFallback"),
      });
    case "provider_base_url_missing":
      return t("settings.models.providerBaseUrlMissing", {
        name: error.providerName || t("settings.models.providerFallback"),
      });
    case "base_url_missing":
      return t("settings.models.baseUrlRequired");
    default:
      return error.error || t("settings.models.testFailed");
  }
}

function providerToForm(provider?: ProviderConfigView): ProviderConfigInput {
  const form: ProviderConfigInput = {
    name: provider?.name ?? "Anthropic compatible",
    baseUrl: provider?.baseUrl ?? "https://api.anthropic.com",
    requestPath: provider?.requestPath ?? "",
    version: provider?.version ?? "v1",
    apiCompat: provider?.apiCompat ?? "anthropic",
    tokenCountMode: provider?.tokenCountMode ?? "local_heuristic",
    apiKey: "",
    defaultModel: provider?.defaultModel ?? "",
    enabled: provider?.enabled ?? true,
  };
  if (provider) {
    form.id = provider.id;
  }
  return form;
}
