import { RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { UpstreamModelOption } from "../shared/models";

interface ModelSelectFieldProps {
  value: string;
  onChange: (modelId: string) => void;
  models: readonly UpstreamModelOption[];
  loading?: boolean;
  error?: string;
  disabled?: boolean;
  onRefresh?: () => void;
}

export function ModelSelectField({
  value,
  onChange,
  models,
  loading,
  error,
  disabled,
  onRefresh,
}: ModelSelectFieldProps) {
  const modelIds = useMemo(() => new Set(models.map((model) => model.id)), [models]);
  const valueInList = Boolean(value && modelIds.has(value));
  const [manualMode, setManualMode] = useState(() => Boolean(value && !modelIds.has(value)));

  useEffect(() => {
    if (value && models.length > 0 && !modelIds.has(value)) {
      setManualMode(true);
    }
  }, [value, models.length, modelIds]);

  const selectValue = manualMode ? "__custom__" : valueInList ? value : "";

  return (
    <div className="model-select-field">
      <div className="model-select-row">
        <select
          className="mcp-field-input model-select-dropdown"
          value={selectValue}
          disabled={disabled || loading}
          onChange={(event) => {
            const next = event.target.value;
            if (next === "__custom__") {
              setManualMode(true);
              return;
            }
            setManualMode(false);
            onChange(next);
          }}
        >
          <option value="">{loading ? "加载模型…" : "选择模型…"}</option>
          {models.map((model) => (
            <option key={model.id} value={model.id}>
              {model.displayName ? `${model.displayName} · ${model.id}` : model.id}
            </option>
          ))}
          <option value="__custom__">手动输入 model id…</option>
        </select>
        {onRefresh && (
          <button
            type="button"
            className="model-refresh-button"
            aria-label="从上游刷新模型列表"
            disabled={disabled || loading}
            onClick={onRefresh}
          >
            <RefreshCw size={16} className={loading ? "model-refresh-spin" : undefined} />
          </button>
        )}
      </div>
      {manualMode && (
        <input
          className="mcp-field-input"
          value={value}
          disabled={disabled}
          placeholder="例如 claude-opus-4-7"
          onChange={(event) => onChange(event.target.value)}
        />
      )}
      {error ? (
        <p className="model-select-hint error">{error}</p>
      ) : (
        !loading &&
        models.length === 0 && (
          <p className="model-select-hint">保存 API Key 后点击刷新；也可直接手动输入 model id。</p>
        )
      )}
    </div>
  );
}
