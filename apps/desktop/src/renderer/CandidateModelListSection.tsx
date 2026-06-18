import { useCallback, useEffect, useState } from "react";
import { Plus, Pencil, Trash2, X, RefreshCw } from "lucide-react";
import type {
  CandidateModelInput,
  CandidateModelView,
  ModelsDevMapping,
  RouteManualSpec,
  UpstreamModelOption,
} from "../shared/ipc";
import { ModelManualSpecPanel } from "./ModelManualSpecPanel";
import { ModelsDevModelSelectField } from "./ModelsDevModelSelectField";
import type { ModelsDevModelOption } from "../shared/ipc";
import type { ManualSpecFormFields } from "./agent-profile-manual-spec-form";
import { emptyManualSpecForm } from "./agent-profile-manual-spec-form";

interface CandidateModelPanelProps {
  providerId: string;
  models: UpstreamModelOption[];
  modelsLoading: boolean;
  modelsDevOptions: readonly ModelsDevModelOption[];
  modelsDevLoading: boolean;
  busy: boolean | undefined;
  onRefreshModels: () => void;
}

function manualSpecToFormFields(spec?: RouteManualSpec): ManualSpecFormFields {
  return {
    contextTokens: spec?.contextTokens?.toString() ?? "",
    maxOutputTokens: spec?.maxOutputTokens?.toString() ?? "",
    supportsImageInput: spec?.supportsImageInput === undefined ? "auto" : spec.supportsImageInput ? "yes" : "no",
    supportsReasoning: spec?.supportsReasoning === undefined ? "auto" : spec.supportsReasoning ? "yes" : "no",
    inputPerM: spec?.inputPerM?.toString() ?? "",
    outputPerM: spec?.outputPerM?.toString() ?? "",
    cacheReadPerM: spec?.cacheReadPerM?.toString() ?? "",
    cacheWritePerM: spec?.cacheWritePerM?.toString() ?? "",
  };
}

function formFieldsToManualSpec(fields: ManualSpecFormFields): RouteManualSpec | undefined {
  const parseNum = (v: string) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  };
  const triToBool = (v: string): boolean | undefined => (v === "yes" ? true : v === "no" ? false : undefined);
  const spec: RouteManualSpec = {};
  const ctx = parseNum(fields.contextTokens);
  const maxOut = parseNum(fields.maxOutputTokens);
  const imgIn = triToBool(fields.supportsImageInput);
  const reasoning = triToBool(fields.supportsReasoning);
  const input = parseNum(fields.inputPerM);
  const output = parseNum(fields.outputPerM);
  const cacheRead = parseNum(fields.cacheReadPerM);
  const cacheWrite = parseNum(fields.cacheWritePerM);
  if (ctx !== undefined) spec.contextTokens = ctx;
  if (maxOut !== undefined) spec.maxOutputTokens = maxOut;
  if (imgIn !== undefined) spec.supportsImageInput = imgIn;
  if (reasoning !== undefined) spec.supportsReasoning = reasoning;
  if (input !== undefined) spec.inputPerM = input;
  if (output !== undefined) spec.outputPerM = output;
  if (cacheRead !== undefined) spec.cacheReadPerM = cacheRead;
  if (cacheWrite !== undefined) spec.cacheWritePerM = cacheWrite;
  return Object.keys(spec).length > 0 ? spec : undefined;
}

function formatResolvedSpec(candidate: CandidateModelView): string {
  const parts: string[] = [];
  if (candidate.resolvedContextTokens) {
    parts.push(`${(candidate.resolvedContextTokens / 1000).toFixed(0)}k ctx`);
  }
  if (candidate.resolvedInputPerM !== undefined) {
    parts.push(`$${candidate.resolvedInputPerM}/M in`);
  }
  if (candidate.resolvedOutputPerM !== undefined) {
    parts.push(`$${candidate.resolvedOutputPerM}/M out`);
  }
  if (candidate.resolvedSupportsImageInput === true) parts.push("🖼️");
  if (candidate.resolvedSupportsReasoning === true) parts.push("🧠");
  return parts.join(" · ");
}

export function CandidateModelPanel({
  providerId,
  models,
  modelsLoading,
  modelsDevOptions,
  modelsDevLoading,
  busy,
  onRefreshModels,
}: CandidateModelPanelProps) {
  const [candidates, setCandidates] = useState<CandidateModelView[]>([]);
  const [loading, setLoading] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingForm, setEditingForm] = useState<ManualSpecFormFields>(emptyManualSpecForm());
  const [editingMapping, setEditingMapping] = useState<ModelsDevMapping | undefined>(undefined);

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
      if (editingId === id) setEditingId(null);
    } catch (error) {
      console.error("Failed to delete candidate model:", error);
    }
  };

  const handleStartEdit = (candidate: CandidateModelView) => {
    setEditingId(candidate.id);
    setEditingForm(manualSpecToFormFields(candidate.manualSpec));
    setEditingMapping(candidate.modelsDevMapping);
  };

  const handleSaveEdit = async () => {
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
    const manualSpecResult = formFieldsToManualSpec(editingForm);
    if (manualSpecResult) input.manualSpec = manualSpecResult;
    try {
      await window.eco!.saveCandidateModel(input);
      await loadCandidates();
      setEditingId(null);
    } catch (error) {
      console.error("Failed to save candidate model:", error);
    }
  };

  const alreadyAddedModelIds = new Set(candidates.map((c) => c.modelId));
  const availableModels = models.filter((m) => !alreadyAddedModelIds.has(m.id));

  return (
    <aside className="candidate-panel">
      <div className="candidate-panel-header">
        <span className="candidate-panel-title">候选模型</span>
        <div className="candidate-panel-header-actions">
          <button
            type="button"
            className="model-inline-refresh"
            disabled={busy || loading}
            onClick={loadCandidates}
            title="刷新"
          >
            <RefreshCw size={14} className={loading ? "model-refresh-spin" : undefined} />
          </button>
          <button
            type="button"
            className="settings-secondary-button candidate-model-add-btn"
            disabled={busy || modelsLoading}
            onClick={() => setPickerOpen(true)}
          >
            <Plus size={14} />
            添加
          </button>
        </div>
      </div>

      <div className="candidate-panel-body">
        {candidates.length === 0 ? (
          <p className="candidate-models-empty">
            暂无候选模型。点击"添加"从上游模型列表中选择。
          </p>
        ) : (
          <div className="candidate-models-list">
            {candidates.map((candidate) => (
              <div key={candidate.id} className="candidate-model-card">
                {editingId === candidate.id ? (
                  <div className="candidate-model-edit">
                    <div className="candidate-model-edit-header">
                      <span className="candidate-model-name">{candidate.modelId}</span>
                      <div className="candidate-model-edit-actions">
                        <button
                          type="button"
                          className="settings-secondary-button"
                          onClick={handleSaveEdit}
                        >
                          保存
                        </button>
                        <button
                          type="button"
                          className="mcp-icon-button"
                          onClick={() => setEditingId(null)}
                        >
                          <X size={14} />
                        </button>
                      </div>
                    </div>
                    <div className="candidate-model-edit-fields">
                      <div className="mcp-field">
                        <span className="mcp-field-label">Models.dev 映射</span>
                        <ModelsDevModelSelectField
                          value={editingMapping}
                          options={modelsDevOptions}
                          loading={modelsDevLoading}
                          disabled={busy}
                          onChange={(mapping) => setEditingMapping(mapping ?? undefined)}
                        />
                      </div>
                      <ModelManualSpecPanel
                        value={editingForm}
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
                      <span className="candidate-model-spec-summary">
                        {formatResolvedSpec(candidate) || "未配置规格"}
                      </span>
                    </div>
                    <div className="candidate-model-actions">
                      <button
                        type="button"
                        className="mcp-icon-button"
                        title="编辑"
                        disabled={busy}
                        onClick={() => handleStartEdit(candidate)}
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        type="button"
                        className="mcp-icon-button"
                        title="删除"
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
}

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
  const [selected, setSelected] = useState<Set<string>>(new Set());

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
            选择模型添加到候选列表
          </h2>
          <button
            type="button"
            className="mcp-icon-button"
            onClick={onClose}
            aria-label="关闭"
          >
            <X size={18} />
          </button>
        </header>
        <div className="candidate-picker-body">
          <div className="candidate-picker-toolbar">
            <button type="button" className="settings-secondary-button" onClick={selectAll}>
              全选
            </button>
            <button type="button" className="settings-secondary-button" onClick={clearSelection}>
              清除选择
            </button>
            <button
              type="button"
              className="settings-secondary-button"
              disabled={loading}
              onClick={onRefreshModels}
            >
              <RefreshCw size={14} className={loading ? "model-refresh-spin" : undefined} />
              刷新列表
            </button>
            <span className="candidate-picker-count">
              已选 {selected.size} / {models.length}
            </span>
          </div>
          {loading && models.length === 0 ? (
            <p className="candidate-picker-loading">正在加载模型列表...</p>
          ) : models.length === 0 ? (
            <p className="candidate-picker-empty">
              暂无可添加的模型。请先刷新模型列表，或所有模型已在候选列表中。
            </p>
          ) : (
            <div className="candidate-picker-list">
              {models.map((model) => (
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
              取消
            </button>
            <button
              type="button"
              className="mcp-save-button"
              disabled={selected.size === 0}
              onClick={() => onConfirm([...selected])}
            >
              添加 {selected.size > 0 ? `(${selected.size})` : ""}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
