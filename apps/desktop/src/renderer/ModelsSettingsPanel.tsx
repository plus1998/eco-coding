import {
  ArrowUp,
  ChevronRight,
  Copy,
  Download,
  LinkIcon,
  Pencil,
  Plus,
  RefreshCw,
  Settings2,
  Star,
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
import {
  type BuiltInPresetDefinition,
  buildPresetResourcesFromDefinition,
  createBuiltInPresetCatalog,
  createUserPresetResourceId,
  createUserPresetResourceName,
} from "../shared/agent-orchestration";
import { isOpenAICompat, UPSTREAM_API_COMPAT_OPTIONS } from "../shared/api-compat";
import type {
  AgentTemplate,
  CandidateModelView,
  McpServerConfigView,
  ModelRef,
  ModelSettingsSnapshot,
  ModelsDevModelOption,
  OrchestrationSelection,
  ProviderConfigInput,
  ProviderConfigView,
  ProxyBridgeSettingsSnapshot,
  SkillsListResult,
} from "../shared/ipc";
import { ROUTE_TEST_THINKING_EFFORT, type UpstreamModelOption } from "../shared/models";
import { hasCompleteOrchestrationSelection } from "../shared/thread-runtime-config";
import { ApiCompatToggle } from "./ApiCompatToggle";
import { AppMessage, type AppMessageKind, formatDurationMs } from "./AppMessage";
import { formatAgentDomainLabel } from "./orchestration-summary";
import { buildAgentTemplateCapabilityOptions } from "./agent-template-form";
import { AgentThemeColorField } from "./agent-theme-color-field";
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
import { AgentCompositionResourcesSection } from "./AgentCompositionResourcesSection";
import { ToolCapabilityPanel } from "./ToolCapabilityPanel";

export type ModelsSettingsTab =
  | "subagents"
  | "providers"
  | "proxyBridge"
  | "presets"
  | "compositionParts";

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
  defaultOrchestrationSelection?: OrchestrationSelection | undefined;
  onDefaultOrchestrationSelectionChange?:
    | ((selection: OrchestrationSelection | undefined) => void | Promise<void>)
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
  onSettingsChange,
  defaultOrchestrationSelection,
  onDefaultOrchestrationSelectionChange,
  onProxyBridgeSettingsChange,
  onSavingChange,
}: ModelsSettingsPanelProps) {
  const { t } = useTranslation();
  const modelsTabItems: Array<{ id: ModelsSettingsTab; label: string }> = [
    { id: "subagents", label: t("settings.models.library") },
    { id: "compositionParts", label: "编排组件" },
    { id: "presets", label: t("settings.models.presets") },
  ];
  const providerSettingsTabItems: Array<{ id: ModelsSettingsTab; label: string }> = [
    { id: "providers", label: t("settings.models.providers") },
    { id: "proxyBridge", label: t("settings.models.proxyBridge") },
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
  const [providerModalOpen, setProviderModalOpen] = useState(false);
  const [providerForm, setProviderForm] = useState<ProviderConfigInput>(() => providerToForm());
  const [modelsCache, setModelsCache] = useState<Record<string, ModelsCacheEntry>>({});
  const [loadingProviderId, setLoadingProviderId] = useState<string | null>(null);
  const [panelError, setPanelError] = useState<string>();
  const [modalError, setModalError] = useState<string>();
  const [testingProviderKey, setTestingProviderKey] = useState<string | null>(null);
  const [providerTestMessage, setProviderTestMessage] = useState<{
    kind: AppMessageKind;
    message: string;
  }>();
  const [presetProfileMessage, setPresetProfileMessage] = useState<{
    kind: AppMessageKind;
    message: string;
  }>();
  const [modelsDevOptions, setModelsDevOptions] = useState<ModelsDevModelOption[]>([]);
  const [modelsDevLoading, setModelsDevLoading] = useState(false);
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

  const copyPresetToProfile = useCallback(
    async (preset: BuiltInPresetDefinition) => {
      if (
        !window.eco?.saveAgentTemplate ||
        !window.eco?.saveMainAgentConfig ||
        !window.eco?.saveSubagentOrchestration
      ) {
        setPresetProfileMessage({
          kind: "error",
          message: t("settings.models.presetImportUnavailable"),
        });
        return;
      }
      const provider = selectPresetDefaultProvider(settings.providers);
      if (!provider) {
        setPresetProfileMessage({
          kind: "error",
          message: t("settings.models.providerRequired"),
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
        const mainAgentConfigId = createUserPresetResourceId(
          preset.id,
          settings.mainAgentConfigs.map((config) => config.id),
        );
        const subagentOrchestrationId = mainAgentConfigId.replace(/\.main_config$/, ".subagents");
        const bundle = buildPresetResourcesFromDefinition(importPlan.presetDefinition, {
          mainAgentConfigId,
          mainAgentConfigName: createUserPresetResourceName(
            `${preset.name} Main Config`,
            settings.mainAgentConfigs.map((config) => config.name),
          ),
          subagentOrchestrationId,
          subagentOrchestrationName: createUserPresetResourceName(
            `${preset.name} Subagents`,
            settings.subagentOrchestrations.map((orchestration) => orchestration.name),
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
              : importPlan.templatesForPreset,
        });
        await window.eco.saveMainAgentConfig(bundle.mainAgentConfig);
        if (bundle.mainAgentPrompt) {
          await window.eco.saveMainAgentPrompt(bundle.mainAgentPrompt);
        }
        await window.eco.saveSubagentOrchestration(bundle.subagentOrchestration);
        await refreshSettings();
        if (hasCompleteOrchestrationSelection(bundle.selection)) {
          await onDefaultOrchestrationSelectionChange?.(bundle.selection);
        }
        setActiveTab("compositionParts");
        const importedTemplateCount = savedTemplates.length;
        const templateMessage =
          importedTemplateCount > 0
            ? t("settings.models.templatesImported", { count: importedTemplateCount })
            : t("settings.models.templatesReused");
        setPresetProfileMessage({
          kind: "success",
          message: t("settings.models.presetCreated", {
            templateMessage,
            resource: bundle.mainAgentConfig.name,
            provider: provider.name,
            model: provider.defaultModel,
          }),
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
    [onDefaultOrchestrationSelectionChange, onSavingChange, refreshSettings, settings],
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
    if (settings.providers.length <= 1) {
      setModalError(t("settings.models.keepProvider"));
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
        showProviderTestMessage("error", result.error ?? t("settings.models.testFailed"));
      }
    } catch (caught) {
      showProviderTestMessage("error", caught instanceof Error ? caught.message : String(caught));
    } finally {
      setTestingProviderKey(null);
    }
  }

  const providerOptions = useMemo(() => settings.providers, [settings.providers]);
  const presetCatalog = useMemo(() => createBuiltInPresetCatalog(), []);

  return (
    <>
      {providerTestMessage && (
        <AppMessage
          kind={providerTestMessage.kind}
          message={providerTestMessage.message}
          onDismiss={() => setProviderTestMessage(undefined)}
        />
      )}
      {presetProfileMessage && (
        <AppMessage
          kind={presetProfileMessage.kind}
          message={presetProfileMessage.message}
          onDismiss={() => setPresetProfileMessage(undefined)}
        />
      )}

      {mode === "providerSettings" ? (
        <header className="mcp-page-header">
          <h1>{t("settings.models.providers")}</h1>
        </header>
      ) : (
        <header className="settings-page-header">
          <h1>{t("settings.models.builder")}</h1>
        </header>
      )}

      <div
        className="models-settings-tabs"
        role="tablist"
        aria-label={
          mode === "providerSettings"
            ? t("settings.models.providerCategories")
            : t("settings.models.categories")
        }
      >
        {(mode === "providerSettings" ? providerSettingsTabItems : modelsTabItems).map((tab) => (
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
          {defaultOrchestrationSelection && hasCompleteOrchestrationSelection(defaultOrchestrationSelection) ? (
            <p className="settings-section-subtitle">
              当前默认编排：{defaultOrchestrationSelection.mainAgentConfigId}
            </p>
          ) : (
            <p className="settings-section-subtitle">尚未设置默认编排组合。</p>
          )}
          <AgentCompositionResourcesSection
            settings={settings}
            mcpServers={mcpServers}
            busy={busy}
            onRegistryChange={refreshSettings}
            onSavingChange={onSavingChange}
          />
        </>
      )}

      {activeTab === "presets" && (
        <section className="mcp-list-section models-presets-section">
          <PresetOverview
            presets={presetCatalog}
            templates={settings.agentTemplates}
            busy={busy || Boolean(presetProfileBusyId)}
            copyingPresetId={presetProfileBusyId}
            onCopyPreset={copyPresetToProfile}
          />
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
          testingModelKey={testingProviderKey}
          busy={busy}
          canDelete={settings.providers.length > 1}
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
  canDelete,
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
  canDelete: boolean;
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
  const [candidatesPanelOpen, setCandidatesPanelOpen] = useState(true);
  const [candidateSaveError, setCandidateSaveError] = useState<string | undefined>(undefined);
  const [ensuringProvider, setEnsuringProvider] = useState(false);
  const candidatePanelRef = useRef<CandidateModelPanelHandle>(null);
  const matchingPreset = findMatchingProviderPreset(form);
  const activePreset = manualPresetSelected ? undefined : matchingPreset;

  async function handleSaveProvider() {
    setCandidateSaveError(undefined);
    try {
      if (isEditing && form.id) {
        await candidatePanelRef.current?.savePendingEdits();
      }
      await onSave({ closeOnSuccess: true });
    } catch (caught) {
      setCandidateSaveError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  async function ensureProviderSavedForCandidates(): Promise<boolean> {
    if (form.id) {
      return true;
    }
    setCandidateSaveError(undefined);
    setEnsuringProvider(true);
    try {
      const provider = await onSave({ closeOnSuccess: false });
      return Boolean(provider?.id);
    } catch (caught) {
      setCandidateSaveError(caught instanceof Error ? caught.message : String(caught));
      return false;
    } finally {
      setEnsuringProvider(false);
    }
  }

  useEffect(() => {
    // Candidate models are the primary place to pick/test models — keep the panel open by default.
    setCandidatesPanelOpen(true);
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
          <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
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
                  const preset = FREE_TOKEN_PROVIDER_PRESETS.find((entry) => entry.id === event.target.value);
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
              <span className="mcp-field-hint">{t("settings.models.provider.rootHint")}</span>
            </label>

            <div className="mcp-field models-provider-endpoint-row">
              <span className="mcp-field-label">{t("settings.models.provider.endpoint")}</span>
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
                  ? t("settings.models.provider.openAiPathHint")
                  : t("settings.models.provider.anthropicPathHint")}
                {" · "}
                {UPSTREAM_API_COMPAT_OPTIONS.find((o) => o.value === (form.apiCompat ?? "anthropic"))?.hint}
              </span>
            </div>

            <label className="mcp-field">
              <span className="mcp-field-label">{t("settings.models.provider.tokenCountMode")}</span>
              <select
                className="mcp-field-input"
                value={form.tokenCountMode ?? "local_heuristic"}
                disabled={busy}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    tokenCountMode: event.target.value as NonNullable<ProviderConfigInput["tokenCountMode"]>,
                  }))
                }
              >
                <option value="local_heuristic">{t("settings.models.provider.localHeuristic")}</option>
                <option value="anthropic_messages">{t("settings.models.provider.anthropicCount")}</option>
                <option value="openai_responses">OpenAI /v1/responses/input_tokens</option>
                <option value="llama_tokenize">llama.cpp /apply-template + /tokenize</option>
              </select>
              <span className="mcp-field-hint">{t("settings.models.provider.tokenCountHint")}</span>
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
                  form.id ? t("settings.models.provider.keepKey") : t("settings.models.provider.optionalKey")
                }
                onChange={(event) => setForm((current) => ({ ...current, apiKey: event.target.value }))}
              />
            </label>

            <label className="mcp-field models-toggle-field">
              <span className="mcp-field-label">{t("settings.models.provider.enable")}</span>
              <label
                className="mcp-toggle mcp-toggle-sm"
                title={form.enabled ? t("common.enabled") : t("common.disabled")}
              >
                <input
                  type="checkbox"
                  checked={form.enabled}
                  disabled={busy || ensuringProvider}
                  onChange={(event) => setForm((current) => ({ ...current, enabled: event.target.checked }))}
                />
                <span className="mcp-toggle-track" aria-hidden />
              </label>
            </label>

            {modelsError ? (
              <p className="mcp-field-hint settings-form-error">
                {t("settings.models.provider.modelsFailed", { detail: modelsError })}
              </p>
            ) : null}

            {error && <p className="settings-form-error">{error}</p>}
            {candidateSaveError ? <p className="settings-form-error">{candidateSaveError}</p> : null}
          </div>

          {candidatesPanelOpen ? (
            form.id ? (
              <CandidateModelPanel
                ref={candidatePanelRef}
                providerId={form.id}
                models={models}
                modelsLoading={modelsLoading}
                modelsDevOptions={modelsDevOptions}
                modelsDevLoading={modelsDevLoading}
                busy={busy || ensuringProvider}
                testingModelKey={testingModelKey}
                onRefreshModels={onRefreshModels}
                onTestModel={onTestCandidate}
              />
            ) : (
              <aside className="candidate-panel">
                <div className="candidate-panel-header">
                  <span className="candidate-panel-title">{t("settings.models.candidateModels")}</span>
                </div>
                <div className="candidate-panel-body">
                  <p className="candidate-models-empty">{t("settings.models.provider.saveFirst")}</p>
                  <button
                    type="button"
                    className="settings-secondary-button"
                    disabled={busy || ensuringProvider || !form.baseUrl.trim() || !form.name.trim()}
                    onClick={() => void ensureProviderSavedForCandidates()}
                  >
                    {ensuringProvider
                      ? t("settings.models.provider.saving")
                      : t("settings.models.provider.saveAndAdd")}
                  </button>
                </div>
              </aside>
            )
          ) : null}
        </div>

        <footer className="settings-modal-footer settings-modal-footer-split">
          {isEditing ? (
            <button
              type="button"
              className="mcp-uninstall-button"
              onClick={onDelete}
              disabled={busy || ensuringProvider || !canDelete}
              title={canDelete ? undefined : t("settings.models.keepProvider")}
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
              disabled={busy || ensuringProvider}
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              className="mcp-save-button"
              disabled={busy || ensuringProvider}
              onClick={() => void handleSaveProvider()}
            >
              {t("common.save")}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

function PresetOverview({
  presets,
  templates,
  busy,
  copyingPresetId,
  onCopyPreset,
}: {
  presets: readonly BuiltInPresetDefinition[];
  templates: readonly AgentTemplate[];
  busy?: boolean;
  copyingPresetId?: string | null;
  onCopyPreset: (preset: BuiltInPresetDefinition) => void;
}) {
  const { t } = useTranslation();
  const templateById = new Map(templates.map((template) => [template.id, template]));
  return (
    <div className="models-preset-grid">
      {presets.map((preset) => {
        const domainTemplates = templates.filter((template) => template.domain === preset.id);
        const missingDefaultAgents = preset.defaultAgents.filter(
          (agent) => !templateById.has(agent.templateId),
        );
        const runnable = missingDefaultAgents.length === 0;
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
                {runnable ? t("settings.models.preset.runnable") : t("settings.models.preset.templatesReady")}
              </span>
            </div>

            <div className="models-preset-metrics">
              <span>
                <strong>{preset.defaultAgents.length}</strong>
                {t("settings.models.preset.subagents")}
              </span>
              <span>
                <strong>{domainTemplates.length}</strong>
                {t("settings.models.preset.templates")}
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
                <span className="models-preset-template is-missing">
                  {t("settings.models.preset.missing", {
                    count: missingDefaultAgents.length,
                  })}
                </span>
              ) : null}
            </div>

            <div className="models-preset-focus">
              <span>{t("settings.models.preset.defaultConfig")}</span>
              <p>{primaryExample?.title ?? preset.modelSuggestion.main}</p>
            </div>

            <div className="models-preset-footer">
              <span className="models-preset-model-suggestion">{preset.modelSuggestion.main}</span>
              <button
                type="button"
                className="models-section-button"
                disabled={busy}
                onClick={() => onCopyPreset(preset)}
                title={t("settings.models.preset.createFrom", {
                  name: formatAgentDomainLabel(preset.id),
                })}
              >
                <Plus size={14} />
                {copyingPresetId === preset.id
                  ? t("settings.models.preset.creating")
                  : t("settings.models.preset.createResources")}
              </button>
            </div>
          </article>
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

function selectPresetDefaultProvider(
  providers: readonly ProviderConfigView[],
): ProviderConfigView | undefined {
  return (
    providers.find((provider) => provider.enabled && provider.defaultModel.trim()) ??
    providers.find((provider) => provider.enabled) ??
    providers.find((provider) => provider.defaultModel.trim()) ??
    providers[0]
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
