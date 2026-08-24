import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { Plus, Pencil, Trash2, X, RefreshCw, Link as LinkIcon, Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import type {
  CandidateModelInput,
  CandidateModelView,
  ModelsDevMapping,
  RouteCapabilityHint,
  RoutePricingHint,
  RuntimeRoleRouteConfig,
  UpstreamModelOption,
} from "../shared/ipc";
import { ModelManualSpecPanel } from "./ModelManualSpecPanel";
import {
  candidateCapabilityHint,
  candidateOverrideFields,
  candidatePricingHint,
  ModelSpecSummary,
} from "./ModelSpecSummary";
import { ModelCascadeSelect } from "./ModelCascadeSelect";
import type { ModelsDevModelOption } from "../shared/ipc";
import type { ManualSpecFormFields } from "./agent-resource-manual-spec-form";
import {
  emptyManualSpecForm,
  prefillManualSpecFormFromCandidate,
  prefillManualSpecFormFromHints,
  tryFormToManualSpec,
} from "./agent-resource-manual-spec-form";

interface CandidateModelPanelProps {
  providerId: string;
  models: UpstreamModelOption[];
  modelsLoading: boolean;
  modelsDevOptions: readonly ModelsDevModelOption[];
  modelsDevLoading: boolean;
  busy: boolean | undefined;
  testingModelKey?: string | null | undefined;
  onRefreshModels: () => void;
  onTestModel?: ((modelId: string) => void) | undefined;
}

export interface CandidateModelPanelHandle {
  hasPendingEdits: () => boolean;
  savePendingEdits: () => Promise<void>;
}

async function lookupCandidateRouteHints(
  providerId: string,
  modelId: string,
  mapping?: ModelsDevMapping,
): Promise<{ capability?: RouteCapabilityHint; pricing?: RoutePricingHint }> {
  const route: RuntimeRoleRouteConfig = {
    role: "planner",
    providerId,
    modelId,
    ...(mapping ? { modelsDevMapping: mapping } : {}),
  };
  const [capabilities, pricing] = await Promise.all([
    window.eco!.getRouteCapabilities([route]),
    window.eco!.getRoutePricing([route]),
  ]);
  return {
    ...(capabilities[0] ? { capability: capabilities[0] } : {}),
    ...(pricing[0] ? { pricing: pricing[0] } : {}),
  };
}

function CandidateModelInlineSpec({ candidate }: { candidate: CandidateModelView }) {
  const { t } = useTranslation();
  const capability = candidateCapabilityHint(candidate);
  const pricing = candidatePricingHint(candidate);
  const overriddenFields = candidateOverrideFields(candidate);
  if (!capability && !pricing) {
    return <span className="candidate-model-spec-empty">{t("candidateModels.noSpec")}</span>;
  }
  return (
    <ModelSpecSummary
      compact
      {...(capability ? { capability } : {})}
      {...(pricing ? { pricing } : {})}
      {...(overriddenFields ? { overriddenFields } : {})}
    />
  );
}

export const CandidateModelPanel = forwardRef<CandidateModelPanelHandle, CandidateModelPanelProps>(
  function CandidateModelPanel(
    {
      providerId,
      models,
      modelsLoading,
      modelsDevOptions,
      modelsDevLoading,
      busy,
      testingModelKey,
      onRefreshModels,
      onTestModel,
    },
    ref,
  ) {
  const { t } = useTranslation();
  const [candidates, setCandidates] = useState<CandidateModelView[]>([]);
  const [loading, setLoading] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingForm, setEditingForm] = useState<ManualSpecFormFields>(emptyManualSpecForm());
  const [editingMapping, setEditingMapping] = useState<ModelsDevMapping | undefined>(undefined);
  const [editingAutoCapability, setEditingAutoCapability] = useState<RouteCapabilityHint | undefined>(
    undefined,
  );
  const [editingAutoPricing, setEditingAutoPricing] = useState<RoutePricingHint | undefined>(undefined);
  const editingIdRef = useRef<string | null>(null);

  const devMappingCascadeOptions = useMemo(
    () =>
      modelsDevOptions.map((option) => ({
        key: `${option.providerKey}::${option.modelId}`,
        providerId: option.providerKey,
        providerName: option.providerKey,
        modelId: option.modelId,
        label: option.displayName,
        description: option.modelId,
      })),
    [modelsDevOptions],
  );

  const loadCandidates = useCallback(async () => {
    if (!providerId) return;
    setLoading(true);
    try {
      const result = await window.eco!.listCandidateModels(providerId);
      setCandidates(result);
    } catch {
      setCandidates([]);
    } finally {
      setLoading(false);
    }
  }, [providerId]);

  useEffect(() => {
    loadCandidates();
  }, [loadCandidates]);

  const handleAddModels = async (selectedModelIds: string[]) => {
    if (!providerId || selectedModelIds.length === 0) return;
    try {
      await window.eco!.bulkImportCandidateModels(providerId, selectedModelIds);
      await loadCandidates();
    } catch (error) {
      console.error("Failed to import candidate models:", error);
    }
    setPickerOpen(false);
  };

  const handleDelete = async (id: string) => {
    try {
      await window.eco!.deleteCandidateModel(id);
      await loadCandidates();
      if (editingId === id) {
        setEditingId(null);
        editingIdRef.current = null;
      }
    } catch (error) {
      console.error("Failed to delete candidate model:", error);
    }
  };

  const refreshEditingCatalogHints = useCallback(
    async (
      candidate: CandidateModelView,
      mapping?: ModelsDevMapping,
      options?: { replaceForm?: boolean },
    ) => {
      const targetId = candidate.id;
      try {
        const hints = await lookupCandidateRouteHints(providerId, candidate.modelId, mapping);
        if (editingIdRef.current !== targetId) {
          return;
        }
        setEditingAutoCapability(hints.capability);
        setEditingAutoPricing(hints.pricing);
        if (options?.replaceForm) {
          setEditingForm(prefillManualSpecFormFromHints(hints.capability, hints.pricing));
        }
      } catch (error) {
        console.error("Failed to resolve candidate model hints:", error);
      }
    },
    [providerId],
  );

  const handleStartEdit = async (candidate: CandidateModelView) => {
    const targetId = candidate.id;
    editingIdRef.current = targetId;
    setEditingId(targetId);
    setEditingMapping(candidate.modelsDevMapping);
    setEditingForm(prefillManualSpecFormFromCandidate(candidate));
    setEditingAutoCapability(undefined);
    setEditingAutoPricing(undefined);
    await refreshEditingCatalogHints(candidate, candidate.modelsDevMapping, {
      replaceForm: !candidate.manualSpec,
    });
  };

  const handleMappingChange = async (
    candidate: CandidateModelView,
    mapping: ModelsDevMapping | undefined,
  ) => {
    setEditingMapping(mapping);
    await refreshEditingCatalogHints(candidate, mapping, { replaceForm: true });
  };

  const handleSaveEdit = useCallback(async () => {
    if (!editingId || !providerId) return;
    const candidate = candidates.find((c) => c.id === editingId);
    if (!candidate) return;
    const input: CandidateModelInput = {
      id: editingId,
      providerId,
      modelId: candidate.modelId,
      sortOrder: candidate.sortOrder,
    };
    if (candidate.displayName) input.displayName = candidate.displayName;
    if (editingMapping) input.modelsDevMapping = editingMapping;
    const manualSpecResult = tryFormToManualSpec(editingForm);
    if (manualSpecResult) input.manualSpec = manualSpecResult;
    await window.eco!.saveCandidateModel(input);
    await loadCandidates();
    setEditingId(null);
    editingIdRef.current = null;
  }, [candidates, editingForm, editingId, editingMapping, loadCandidates, providerId]);

  useImperativeHandle(
    ref,
    () => ({
      hasPendingEdits: () => editingIdRef.current !== null,
      savePendingEdits: async () => {
        if (editingIdRef.current === null) {
          return;
        }
        await handleSaveEdit();
      },
    }),
    [handleSaveEdit],
  );

  const alreadyAddedModelIds = new Set(candidates.map((c) => c.modelId));
  const availableModels = models.filter((m) => !alreadyAddedModelIds.has(m.id));

  return (
    <aside className="candidate-panel">
      <div className="candidate-panel-header">
        <div className="candidate-panel-title-row">
          <span className="candidate-panel-title">{t("settings.models.candidateModels")}</span>
          {candidates.length > 0 ? (
            <span className="candidate-panel-count" aria-hidden="true">
              {candidates.length}
            </span>
          ) : null}
        </div>
        <div className="candidate-panel-header-actions">
          <button
            type="button"
            className="mcp-icon-button candidate-panel-icon-btn"
            disabled={busy || loading}
            onClick={loadCandidates}
            title={t("common.refresh")}
            aria-label={t("common.refresh")}
          >
            <RefreshCw size={14} className={loading ? "model-refresh-spin" : undefined} />
          </button>
          <button
            type="button"
            className="mcp-icon-button candidate-panel-icon-btn"
            disabled={busy || modelsLoading}
            onClick={() => setPickerOpen(true)}
            title={t("candidateModels.add")}
            aria-label={t("candidateModels.add")}
          >
            <Plus size={14} />
          </button>
        </div>
      </div>

      <div className="candidate-panel-body">
        {candidates.length === 0 ? (
          <p className="candidate-models-empty">
            {t("candidateModels.empty")}
          </p>
        ) : (
          <div className="candidate-models-list">
            {candidates.map((candidate) => (
              <div
                key={candidate.id}
                className={`candidate-model-card${editingId === candidate.id ? " is-editing" : ""}`}
              >
                {editingId === candidate.id ? (
                  <div className="candidate-model-edit">
                    <div className="candidate-model-edit-header">
                      <div className="candidate-model-edit-title">
                        <span className="candidate-model-edit-label">{t("common.edit")}</span>
                        <span className="candidate-model-name">{candidate.modelId}</span>
                      </div>
                      <div className="candidate-model-edit-actions">
                        <button
                          type="button"
                          className="settings-secondary-button candidate-model-save-btn"
                          onClick={() => {
                            void handleSaveEdit().catch((error) => {
                              console.error("Failed to save candidate model:", error);
                            });
                          }}
                        >
                          {t("common.save")}
                        </button>
                        <button
                          type="button"
                          className="mcp-icon-button"
                          aria-label={t("candidateModels.cancelEdit")}
                          onClick={() => {
                            setEditingId(null);
                            editingIdRef.current = null;
                          }}
                        >
                          <X size={14} />
                        </button>
                      </div>
                    </div>
                    <div className="candidate-model-edit-fields">
                      <section className="candidate-model-edit-section">
                        <h4 className="candidate-model-edit-section-title">
                          {t("modelSpec.modelsDevMapping")}
                        </h4>
                        {(() => {
                          const autoResolved =
                            !editingMapping &&
                            Boolean(editingAutoCapability?.resolvedModelsDevMapping);
                          const autoResolvedMapping =
                            editingAutoCapability?.resolvedModelsDevMapping;
                          const autoResolvedLabel =
                            editingAutoCapability?.resolvedModelsDevLabel;
                          const autoMatchSummary =
                            autoResolved && autoResolvedMapping
                              ? (autoResolvedLabel ??
                                  `${autoResolvedMapping.providerKey}/${autoResolvedMapping.modelId}`)
                              : undefined;
                          const autoMatchedKey =
                            autoResolvedMapping
                              ? `${autoResolvedMapping.providerKey}::${autoResolvedMapping.modelId}`
                              : undefined;
                          const manualOption = editingMapping
                            ? devMappingCascadeOptions.find(
                                (option) =>
                                  option.providerId === editingMapping.providerKey &&
                                  option.modelId === editingMapping.modelId,
                              )
                            : undefined;
                          const manualLabel = editingMapping
                            ? manualOption
                              ? `${manualOption.label} · ${editingMapping.providerKey}/${editingMapping.modelId}`
                              : `${editingMapping.providerKey}/${editingMapping.modelId}`
                            : undefined;
                          return (
                            <ModelCascadeSelect
                              value={
                                editingMapping
                                  ? {
                                      key: `${editingMapping.providerKey}::${editingMapping.modelId}`,
                                      providerId: editingMapping.providerKey,
                                      modelId: editingMapping.modelId,
                                    }
                                  : undefined
                              }
                              secondaryValue={
                                autoResolved && autoResolvedMapping
                                  ? {
                                      key: `${autoResolvedMapping.providerKey}::${autoResolvedMapping.modelId}`,
                                      providerId: autoResolvedMapping.providerKey,
                                      modelId: autoResolvedMapping.modelId,
                                    }
                                  : undefined
                              }
                              options={devMappingCascadeOptions}
                              loading={modelsDevLoading}
                              disabled={busy}
                              clearable
                              clearLabel={
                                autoMatchSummary
                                  ? `${t("modelsDevSelect.auto")}${t("modelsDevSelect.currentMatch", { model: autoMatchSummary })}`
                                  : `${t("modelsDevSelect.auto")}${t("modelsDevSelect.inferFromId")}`
                              }
                              placeholder={t("modelsDevSelect.placeholder")}
                              renderExtra={
                                autoMatchedKey && !editingMapping
                                  ? (option) =>
                                      option.key === autoMatchedKey ? (
                                        <span className="model-cascade-model-extra">
                                          {t("modelsDevSelect.autoMatchedSuffix")}
                                        </span>
                                      ) : null
                                  : undefined
                              }
                              footer={
                                manualLabel ? (
                                  <p className="model-cascade-hint">
                                    {t("modelsDevSelect.manualMapping", { model: manualLabel })}
                                  </p>
                                ) : autoMatchSummary ? (
                                  <p className="model-cascade-hint">
                                    {t("modelsDevSelect.autoMatch", { model: autoMatchSummary })}
                                  </p>
                                ) : (
                                  <p className="model-cascade-hint is-unresolved">
                                    {t("modelsDevSelect.unresolved")}
                                  </p>
                                )
                              }
                              onChange={(selection) =>
                                void handleMappingChange(
                                  candidate,
                                  selection
                                    ? {
                                        providerKey: selection.providerId,
                                        modelId: selection.modelId,
                                      }
                                    : undefined,
                                )
                              }
                            />
                          );
                        })()}
                      </section>
                      <ModelManualSpecPanel
                        variant="sidebar"
                        value={editingForm}
                        {...(editingAutoCapability ? { autoCapability: editingAutoCapability } : {})}
                        {...(editingAutoPricing ? { autoPricing: editingAutoPricing } : {})}
                        {...(editingMapping ? { mapping: editingMapping } : {})}
                        {...(busy !== undefined ? { disabled: busy } : {})}
                        onChange={(patch) => setEditingForm((prev) => ({ ...prev, ...patch }))}
                      />
                    </div>
                  </div>
                ) : (
                  <div className="candidate-model-summary">
                    <div className="candidate-model-summary-main">
                      <span className="candidate-model-name">
                        {candidate.displayName || candidate.modelId}
                      </span>
                      {candidate.modelsDevLabel ? (
                        <span className="candidate-model-dev-label">{candidate.modelsDevLabel}</span>
                      ) : null}
                      <CandidateModelInlineSpec candidate={candidate} />
                    </div>
                    <div className="candidate-model-actions">
                      {onTestModel ? (
                        <button
                          type="button"
                          className="mcp-icon-button"
                          title={t("settings.models.testConnectivity", {
                            name: candidate.modelId,
                          })}
                          aria-label={t("settings.models.testConnectivity", {
                            name: candidate.modelId,
                          })}
                          disabled={busy || Boolean(testingModelKey)}
                          onClick={() => onTestModel(candidate.modelId)}
                        >
                          {testingModelKey === `${providerId}::${candidate.modelId}` ? (
                            <RefreshCw size={14} className="model-refresh-spin" />
                          ) : (
                            <LinkIcon size={14} />
                          )}
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="mcp-icon-button"
                        title={t("common.edit")}
                        disabled={busy}
                        onClick={() => handleStartEdit(candidate)}
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        type="button"
                        className="mcp-icon-button candidate-model-delete"
                        title={t("common.delete")}
                        disabled={busy}
                        onClick={() => handleDelete(candidate.id)}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {pickerOpen && (
        <CandidateModelPickerModal
          models={availableModels}
          loading={modelsLoading}
          onClose={() => setPickerOpen(false)}
          onConfirm={handleAddModels}
          onRefreshModels={onRefreshModels}
        />
      )}
    </aside>
  );
},
);

interface CandidateModelPickerModalProps {
  models: UpstreamModelOption[];
  loading: boolean;
  onClose: () => void;
  onConfirm: (selectedModelIds: string[]) => void;
  onRefreshModels: () => void;
}

function CandidateModelPickerModal({
  models,
  loading,
  onClose,
  onConfirm,
  onRefreshModels,
}: CandidateModelPickerModalProps) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);

  const filteredModels = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) {
      return models;
    }
    return models.filter((model) => {
      const label = (model.displayName || model.id).toLowerCase();
      return label.includes(query) || model.id.toLowerCase().includes(query);
    });
  }, [models, searchQuery]);

  const toggleSelection = (modelId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(modelId)) {
        next.delete(modelId);
      } else {
        next.add(modelId);
      }
      return next;
    });
  };

  const selectAll = () => {
    if (searchQuery.trim()) {
      setSelected((prev) => {
        const next = new Set(prev);
        for (const model of filteredModels) {
          next.add(model.id);
        }
        return next;
      });
      return;
    }
    setSelected(new Set(models.map((m) => m.id)));
  };

  const clearSelection = () => {
    setSelected(new Set());
  };

  return (
    <div className="settings-modal-backdrop candidate-picker-backdrop">
      <div
        className="settings-modal candidate-picker-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="candidate-picker-title"
      >
        <header className="settings-modal-header">
          <h2 id="candidate-picker-title" className="settings-modal-title">
            {t("candidateModels.pickerTitle")}
          </h2>
          <button
            type="button"
            className="mcp-icon-button"
            onClick={onClose}
            aria-label={t("common.close")}
          >
            <X size={18} />
          </button>
        </header>
        <div className="candidate-picker-body">
          <div className="candidate-picker-toolbar">
            <button type="button" className="settings-secondary-button" onClick={selectAll}>
              {t("candidateModels.selectAll")}
            </button>
            <button type="button" className="settings-secondary-button" onClick={clearSelection}>
              {t("candidateModels.clearSelection")}
            </button>
            <button
              type="button"
              className="settings-secondary-button"
              disabled={loading}
              onClick={onRefreshModels}
            >
              <RefreshCw size={14} className={loading ? "model-refresh-spin" : undefined} />
              {t("candidateModels.refreshList")}
            </button>
            <span className="candidate-picker-count">
              {t("candidateModels.selectedCount", {
                selected: selected.size,
                total: models.length,
              })}
            </span>
          </div>
          <label className="candidate-picker-search">
            <Search size={14} aria-hidden />
            <input
              ref={searchInputRef}
              type="search"
              value={searchQuery}
              placeholder={t("candidateModels.searchPlaceholder")}
              aria-label={t("candidateModels.searchPlaceholder")}
              onChange={(event) => setSearchQuery(event.target.value)}
            />
            {searchQuery ? (
              <button
                type="button"
                className="candidate-picker-search-clear"
                aria-label={t("common.close")}
                onClick={() => {
                  setSearchQuery("");
                  searchInputRef.current?.focus();
                }}
              >
                <X size={12} aria-hidden />
              </button>
            ) : null}
          </label>
          {loading && models.length === 0 ? (
            <p className="candidate-picker-loading">{t("candidateModels.loading")}</p>
          ) : models.length === 0 ? (
            <p className="candidate-picker-empty">
              {t("candidateModels.noneAvailable")}
            </p>
          ) : filteredModels.length === 0 ? (
            <p className="candidate-picker-empty">{t("modelCascade.noMatch")}</p>
          ) : (
            <div className="candidate-picker-list">
              {filteredModels.map((model) => (
                <label key={model.id} className="candidate-picker-item">
                  <input
                    type="checkbox"
                    checked={selected.has(model.id)}
                    onChange={() => toggleSelection(model.id)}
                  />
                  <span className="candidate-picker-item-label">
                    {model.displayName || model.id}
                  </span>
                </label>
              ))}
            </div>
          )}
        </div>
        <footer className="settings-modal-footer settings-modal-footer-split">
          <span />
          <div className="settings-modal-footer-actions">
            <button type="button" className="settings-modal-cancel" onClick={onClose}>
              {t("common.cancel")}
            </button>
            <button
              type="button"
              className="mcp-save-button"
              disabled={selected.size === 0}
              onClick={() => onConfirm([...selected])}
            >
              {t("candidateModels.addCount", {
                count: selected.size > 0 ? `(${selected.size})` : "",
              })}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
