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
  buildOrchestrationProfileFromPreset,
  createBuiltInPresetCatalog,
  createUserPresetProfileId,
  createUserPresetProfileName,
} from "../shared/agent-orchestration";
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
import { ToolCapabilityPanel } from "./ToolCapabilityPanel";

export type ModelsSettingsTab =
  | "subagents"
  | "routes"
  | "providers"
  | "proxyBridge"
  | "presets";

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
  defaultAgentProfileId?: string | undefined;
  onDefaultAgentProfileChange?: ((profileId: string | undefined) => void | Promise<void>) | undefined;
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
  defaultAgentProfileId,
  onDefaultAgentProfileChange,
  onProxyBridgeSettingsChange,
  onSavingChange,
}: ModelsSettingsPanelProps) {
  const { t } = useTranslation();
  const modelsTabItems: Array<{ id: ModelsSettingsTab; label: string }> = [
    { id: "subagents", label: t("settings.models.library") },
    { id: "routes", label: t("settings.models.configurations") },
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
      setProfileArchiveMessage({ kind: "error", message: t("settings.models.exportUnavailable") });
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
        message: t("settings.models.exported", {
          count: result.exported,
          path: result.path ? t("settings.models.exportPath", { path: result.path }) : "",
        }),
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
      setProfileArchiveMessage({ kind: "error", message: t("settings.models.importUnavailable") });
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
            ? t("settings.models.importedWithErrors", {
                count: result.imported,
                errors: result.errors.length,
              })
            : t("settings.models.imported", { count: result.imported }),
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
            ? t("settings.models.templatesImported", { count: importedTemplateCount })
            : t("settings.models.templatesReused");
        setPresetProfileMessage({
          kind: "success",
          message: t("settings.models.presetCreated", {
            templateMessage,
            profile: profile.name,
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
    if (!window.confirm(t("settings.models.confirmDeleteProfile", { name: profile.name }))) {
      return;
    }
    onSavingChange?.(true);
    try {
      await window.eco.deleteOrchestrationProfile(profile.id);
      await refreshSettings();
      if (profile.id === defaultAgentProfileId) {
        const replacementProfileId = settings.orchestrationProfiles.find(
          (candidate) => candidate.id !== profile.id,
        )?.id;
        await onDefaultAgentProfileChange?.(replacementProfileId);
      }
    } catch (caught) {
      setPanelError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      onSavingChange?.(false);
    }
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
    if (
      !window.confirm(t("settings.models.confirmDeleteProvider", { name: providerName }))
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
      ["planner", profile.mainAgent.name || t("settings.models.mainAgent")],
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
        const durationHint =
          durations.length > 0
            ? t("settings.models.durationHint", { duration: durations[0] })
            : "";
        const dedupeHint =
          uniqueModels.size < result.passed
            ? t("settings.models.dedupeHint", {
                groups: uniqueModels.size,
                count: result.passed,
              })
            : "";
        setAgentProfileTestMessage({
          kind: "success",
          message: t("settings.models.profileTestPassed", {
            name: profile.name,
            count: result.passed,
            dedupe: dedupeHint,
            duration: durationHint,
          }),
        });
      } else {
        const failedLabels = result.results
          .filter((entry) => !entry.ok)
          .map(
            (entry) =>
              `${displayNames.get(entry.role) ?? entry.role}: ${
                entry.error ?? t("settings.models.failedFallback")
              }`,
          )
          .join("；");
        setAgentProfileTestMessage({
          kind: "error",
          message: t("settings.models.profileTestPartial", {
            name: profile.name,
            passed: result.passed,
            total: result.results.length,
            failures: failedLabels,
          }),
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
  const selectableProfileSummaries = useMemo(() => listSelectableAgentProfileSummaries(settings), [settings]);
  const allProfileSummaries = useMemo(
    () => settings.orchestrationProfiles.map((profile) => buildAgentProfileSummary(settings, profile)),
    [settings],
  );
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
                {t("settings.models.importProfile")}
              </button>
              <button
                type="button"
                className="models-section-button"
                disabled={busy || profileArchiveBusy}
                onClick={() => void exportAgentProfiles()}
              >
                <Download size={14} />
                {t("settings.models.exportProfile")}
              </button>
              <button
                type="button"
                className="mcp-add-button"
                disabled={busy}
                onClick={openCreateAgentProfile}
              >
                <Plus size={16} />
                {t("settings.models.addProfile")}
              </button>
            </div>
          </div>

          {selectableProfileSummaries.length === 0 ? (
            <p className="mcp-list-empty">{t("settings.models.noProfiles")}</p>
          ) : (
            <ul className="mcp-server-list">
              {selectableProfileSummaries.map((summary) => {
                const editableProfile = canEditStoredAgentProfile(summary.profile);
                const testingProfile = testingAgentProfileId === summary.profile.id;
                const defaultProfile = summary.profile.id === defaultAgentProfileId;
                return (
                  <li key={summary.profile.id} className="mcp-server-row models-agent-profile-row">
                    <AgentProfileSummaryBlock summary={summary} isDefault={defaultProfile} />
                    <div className="mcp-server-actions">
                      <button
                        type="button"
                        className={defaultProfile ? "mcp-icon-button is-active" : "mcp-icon-button"}
                        disabled={busy || defaultProfile}
                        onClick={() => void onDefaultAgentProfileChange?.(summary.profile.id)}
                        aria-label={
                          defaultProfile
                            ? t("settings.models.isDefaultAria", { name: summary.name })
                            : t("settings.models.setDefaultAria", { name: summary.name })
                        }
                        title={
                          defaultProfile
                            ? t("settings.models.isDefault")
                            : t("settings.models.setDefault")
                        }
                      >
                        <Star size={18} fill={defaultProfile ? "currentColor" : "none"} />
                      </button>
                      <button
                        type="button"
                        className="mcp-icon-button"
                        disabled={busy || testingAgentProfileId !== null}
                        onClick={() => void testAgentProfile(summary.profile)}
                        aria-label={t("settings.models.testConnectivity", { name: summary.name })}
                        title={t("settings.models.testConnectivity", { name: summary.name })}
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
                        aria-label={t("settings.models.copyNamed", { name: summary.name })}
                        title={t("settings.models.copyNamed", { name: summary.name })}
                        disabled={busy}
                      >
                        <Copy size={18} />
                      </button>
                      <button
                        type="button"
                        className="mcp-icon-button"
                        onClick={() => void exportAgentProfiles([summary.profile.id])}
                        aria-label={t("settings.models.exportNamed", { name: summary.name })}
                        title={t("settings.models.exportNamed", { name: summary.name })}
                        disabled={busy || profileArchiveBusy}
                      >
                        <Download size={18} />
                      </button>
                      <button
                        type="button"
                        className="mcp-icon-button"
                        onClick={() => openEditAgentProfile(summary.profile)}
                        aria-label={
                          editableProfile
                            ? t("settings.models.editNamed", { name: summary.name })
                            : t("settings.models.copyNamed", { name: summary.name })
                        }
                        title={
                          editableProfile
                            ? t("settings.models.editNamed", { name: summary.name })
                            : t("settings.models.copyNamed", { name: summary.name })
                        }
                        disabled={busy}
                      >
                        <Pencil size={18} />
                      </button>
                      {editableProfile ? (
                        <button
                          type="button"
                          className="mcp-icon-button danger"
                          onClick={() => void deleteAgentProfile(summary.profile)}
                          aria-label={t("settings.models.deleteNamed", { name: summary.name })}
                          title={t("settings.models.deleteNamed", { name: summary.name })}
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
  | { kind: "agent"; agentKey: string };

export function AgentProfileEditorModal({
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
  const { t } = useTranslation();
  const modalTitle =
    mode === "edit"
      ? t("settings.models.editor.editTitle")
      : mode === "copy"
        ? t("settings.models.editor.copyTitle")
        : t("settings.models.editor.createTitle");
  const modalBadge =
    mode === "edit"
      ? t("common.edit")
      : mode === "copy"
        ? t("settings.models.editor.copyBadge")
        : t("settings.models.editor.newBadge");
  const modalHint =
    mode === "edit"
      ? t("settings.models.editor.editHint")
      : mode === "copy"
        ? t("settings.models.editor.copyHint")
        : t("settings.models.editor.createHint");
  const saveLabel =
    mode === "edit"
      ? t("settings.models.editor.saveChanges")
      : mode === "copy"
        ? t("settings.models.editor.createCopy")
        : t("common.create");
  const activeProvider = providers.find((provider) => provider.id === form.mainProviderId);
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
        aria-label={t("common.close")}
        title={t("common.close")}
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
            aria-label={t("common.close")}
            title={t("common.close")}
            disabled={busy}
          >
            <X size={18} />
          </button>
        </header>

        <div className="settings-modal-body mcp-editor-form models-agent-profile-form">
          <section className="models-agent-profile-form-section">
            <div className="models-agent-profile-meta-grid">
              <label className="mcp-field">
                <span className="mcp-field-label">{t("settings.models.editor.profileName")}</span>
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
                  {form.source === "project"
                    ? t("settings.models.editor.project")
                    : t("settings.models.editor.user")}
                </span>
              </div>
            </div>
          </section>

          <section className="models-agent-profile-form-section">
            <div className="models-agent-profile-visual-builder">
              <aside className="models-agent-profile-palette" aria-label={t("settings.models.library")}>
                <div className="models-agent-profile-builder-head">
                  <h3 className="models-route-profile-section-title">{t("settings.models.library")}</h3>
                  <span className="models-agent-source-badge">{selectableTemplates.length} 可选</span>
                </div>
                {templates.length === 0 ? (
                  <p className="mcp-list-empty">{t("settings.models.editor.libraryEmpty")}</p>
                ) : selectableTemplates.length === 0 ? (
                  <p className="mcp-list-empty">{t("settings.models.editor.libraryAllAdded")}</p>
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
                aria-label={t("settings.models.editor.canvas")}
                onDragOver={handleCanvasDragOver}
                onDrop={handleCanvasDrop}
              >
                <div className="models-agent-profile-builder-head">
                  <div>
                    <h3 className="models-route-profile-section-title">{t("settings.models.editor.canvas")}</h3>
                    <p className="models-agent-profile-builder-subtitle">
                      主 Agent 和 {form.agents.length} 个子代理节点
                    </p>
                  </div>
                  <span className="models-agent-source-badge">
                    {form.mainSystemPromptPreset === "core_native"
                      ? t("settings.models.editor.followAgent")
                      : t("settings.models.editor.customInstructions")}
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
                      {(activeProvider?.name ?? form.mainProviderId) ||
                        t("settings.models.editor.noProvider")}{" "}
                      / {form.mainModelId || t("settings.models.editor.noModel")}
                    </span>
                    <span className="models-agent-profile-node-footer">
                      <Settings2 size={14} />
                      配置
                    </span>
                  </button>

                  <div className="models-agent-profile-node-rail" aria-hidden />

                  <div className="models-agent-profile-node-column">
                    {form.agents.length === 0 ? (
                      <div className="models-agent-profile-empty-drop">
                        <span>{t("settings.models.editor.dropAgents")}</span>
                        <small>{t("settings.models.editor.dropAgentsHint")}</small>
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
                                  {template
                                    ? formatAgentDomainLabel(template.domain)
                                    : t("settings.models.editor.templateMissing")}
                                </span>
                                <span className="models-agent-profile-node-title">{nodeTitle}</span>
                                <span className="models-agent-profile-node-key">{agent.agentKey}</span>
                                <span className="models-agent-profile-node-model">
                                  {(provider?.name ?? agent.providerId) ||
                                    t("settings.models.editor.noProvider")}{" "}
                                  / {agent.modelId || t("settings.models.editor.noModel")}
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
                                aria-label={t("settings.models.editor.removeNode", { name: nodeTitle })}
                                title={t("settings.models.editor.removeNode", { name: nodeTitle })}
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
            {t("common.cancel")}
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
  const { t } = useTranslation();
  return (
    <div className="mcp-field">
      <span className="mcp-field-label">{t("settings.models.candidateModels")}</span>
      {loading ? (
        <span className="mcp-field-hint">{t("settings.models.loading")}</span>
      ) : candidates.length === 0 ? (
        <span className="mcp-field-hint candidate-model-empty-hint">
          {t("settings.models.addCandidatesFirst")}
        </span>
      ) : (
        <select
          className="mcp-field-input"
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="">{t("settings.models.selectCandidate")}</option>
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
  const { t } = useTranslation();
  return (
    <label className="mcp-field">
      <span className="mcp-field-label">{t("settings.models.thinkingEffort")}</span>
      <select className="mcp-field-input" value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
        <option value="">{t("common.default")}</option>
        <option value="off">{t("settings.models.effort.off")}</option>
        <option value="low">{t("settings.models.effort.low")}</option>
        <option value="medium">{t("settings.models.effort.medium")}</option>
        <option value="high">{t("settings.models.effort.high")}</option>
        <option value="xhigh">{t("settings.models.effort.xhigh")}</option>
        <option value="max">{t("settings.models.effort.max")}</option>
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
  const { t } = useTranslation();
  return (
    <label className="mcp-field">
      <span className="mcp-field-label">{t("settings.models.apiCompat")}</span>
      <select className="mcp-field-input" value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
        <option value="">{t("common.default")}</option>
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
  const { t } = useTranslation();
  return (
    <div className="profile-node-model-fields">
      <div className="models-agent-template-form-grid">
        <label className="mcp-field">
          <span className="mcp-field-label">{t("settings.models.providers")}</span>
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
  const { t } = useTranslation();
  const isMainNode = node.kind === "main";
  const nodeProviderId = isMainNode ? form.mainProviderId : (agent?.providerId ?? "");
  const { candidates: nodeCandidates, loading: nodeCandidatesLoading } = useCandidateModels(nodeProviderId);
  const selectedCandidateId = isMainNode ? form.mainCandidateModelId : (agent?.candidateModelId ?? "");
  const selectedCandidate = nodeCandidates.find((candidate) => candidate.id === selectedCandidateId);
  const nodeTitle = isMainNode
    ? t("settings.models.node.mainTitle")
    : t("settings.models.node.agentTitle", {
        name:
          template?.name ??
          agent?.displayName ??
          agent?.agentKey ??
          t("settings.models.node.subagent"),
      });
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

  if (!isMainNode && (!agent || agentIndex < 0)) {
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
        aria-label={t("settings.models.node.close")}
        title={t("settings.models.node.close")}
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
            aria-label={t("common.close")}
            title={t("common.close")}
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
                    {form.mainSystemPromptPreset === "core_native"
                      ? t("settings.models.editor.followAgent")
                      : t("settings.models.editor.customInstructions")}
                  </span>
                </div>
                <p className="models-subagent-card-desc">
                  {t("settings.models.node.mainDescription")}
                </p>
              </div>

              <div className="models-agent-template-form-grid">
                <label className="mcp-field">
                  <span className="mcp-field-label">{t("settings.models.node.name")}</span>
                  <input
                    className="mcp-field-input"
                    value={form.mainName}
                    disabled={busy}
                    onChange={(event) => onPatchProfile({ mainName: event.target.value })}
                  />
                </label>
                <label className="mcp-field">
                  <span className="mcp-field-label">{t("settings.models.node.systemPrompt")}</span>
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
                    <option value="core_native">{t("settings.models.editor.followAgent")}</option>
                    <option value="custom_append">
                      {t("settings.models.editor.customInstructions")}
                    </option>
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

              {form.mainSystemPromptPreset === "custom_append" ? (
                <label className="mcp-field">
                  <span className="mcp-field-label">{t("settings.models.node.mainPrompt")}</span>
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
                    <span className="models-agent-source-badge">
                      {t("settings.models.editor.templateMissing")}
                    </span>
                  )}
                  <span className="models-route-role-id">{agent?.agentKey}</span>
                </div>
                <p className="models-subagent-card-desc">
                  {template?.description ??
                    t("settings.models.node.templateReference", {
                      id: agent?.templateId ?? "",
                    })}
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
                  label={t("settings.models.node.themeColor")}
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
            {t("common.close")}
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
              <span className="mcp-field-hint">
                {t("settings.models.provider.rootHint")}
              </span>
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
            {candidateSaveError ? (
              <p className="settings-form-error">{candidateSaveError}</p>
            ) : null}
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
                  <p className="candidate-models-empty">
                    {t("settings.models.provider.saveFirst")}
                  </p>
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
            <button type="button" className="settings-modal-cancel" onClick={onClose} disabled={busy || ensuringProvider}>
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

function AgentProfileSummaryBlock({
  summary,
  isDefault,
}: {
  summary: AgentProfileSummary;
  isDefault: boolean;
}) {
  const { t } = useTranslation();
  const visibleAgents = summary.enabledAgents.slice(0, 5);
  const hiddenCount = Math.max(0, summary.enabledAgents.length - visibleAgents.length);
  return (
    <div className="models-agent-profile-main">
      <div className="models-agent-profile-title-row">
        <span className="mcp-server-name">{summary.name}</span>
        <span className="models-agent-domain-badge">{summary.presetLabel}</span>
        <span className="models-agent-source-badge">{summary.sourceLabel}</span>
        {isDefault ? (
          <span className="models-agent-default-badge">{t("common.default")}</span>
        ) : null}
      </div>
      <div className="models-agent-profile-meta">
        <span>{t("settings.models.summary.main", { model: summary.main.modelLabel })}</span>
        <span>
          {t("settings.models.summary.enabledAgents", {
            count: summary.enabledAgents.length,
          })}
        </span>
        {summary.disabledAgentCount > 0 ? (
          <span>
            {t("settings.models.summary.disabledAgents", {
              count: summary.disabledAgentCount,
            })}
          </span>
        ) : null}
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
            <span className="models-agent-profile-agent-name">{t("settings.models.summary.more")}</span>
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
  const { t } = useTranslation();
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
                {runnable
                  ? t("settings.models.preset.runnable")
                  : t("settings.models.preset.templatesReady")}
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
              <span>
                <strong>{domainProfiles.length}</strong>
                Profile
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
                  : t("settings.models.preset.copyProfile")}
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
