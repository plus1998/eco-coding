import { ChevronDown, RefreshCw } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { UpstreamModelOption } from "../shared/models";

interface ModelSelectFieldProps {
  value: string;
  onChange: (modelId: string) => void;
  models: readonly UpstreamModelOption[];
  loading?: boolean | undefined;
  error?: string | undefined;
  disabled?: boolean | undefined;
  onRefresh?: (() => void) | undefined;
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
  const listboxId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);

  const filteredModels = useMemo(() => {
    const query = value.trim().toLowerCase();
    if (!query) {
      return models;
    }
    return models.filter((model) => {
      const id = model.id.toLowerCase();
      const name = model.displayName?.toLowerCase() ?? "";
      return id.includes(query) || name.includes(query);
    });
  }, [models, value]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const handlePointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  function toggleDropdown() {
    if (disabled || loading) {
      return;
    }
    setOpen((current) => {
      const next = !current;
      if (next && models.length === 0 && onRefresh && !error) {
        onRefresh();
      }
      return next;
    });
  }

  function selectModel(modelId: string) {
    onChange(modelId);
    setOpen(false);
    inputRef.current?.focus();
  }

  return (
    <div className="model-select-field" ref={rootRef}>
      <div className="model-combobox-row">
        <div className={`model-combobox-input-wrap${open ? " is-open" : ""}`}>
          <input
            ref={inputRef}
            type="text"
            className="mcp-field-input model-combobox-input"
            value={value}
            disabled={disabled}
            placeholder="输入或选择模型"
            role="combobox"
            aria-expanded={open}
            aria-controls={listboxId}
            aria-autocomplete="list"
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown" && !open) {
                event.preventDefault();
                setOpen(true);
                if (models.length === 0 && onRefresh && !error) {
                  onRefresh();
                }
              }
            }}
          />
          <button
            type="button"
            className="model-combobox-toggle"
            aria-label={open ? "收起模型列表" : "展开远程模型列表"}
            aria-expanded={open}
            aria-controls={listboxId}
            disabled={disabled || loading}
            onClick={toggleDropdown}
          >
            <ChevronDown size={16} className={open ? "model-combobox-chevron is-open" : "model-combobox-chevron"} />
          </button>
        </div>
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

      {open && (
        <ul id={listboxId} className="model-combobox-menu" role="listbox">
          {loading ? (
            <li className="model-combobox-menu-status">加载模型…</li>
          ) : filteredModels.length > 0 ? (
            filteredModels.map((model) => (
              <li key={model.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={model.id === value}
                  className={`model-combobox-option${model.id === value ? " is-selected" : ""}`}
                  onClick={() => selectModel(model.id)}
                >
                  <span className="model-combobox-option-label">
                    {model.displayName ? `${model.displayName} · ${model.id}` : model.id}
                  </span>
                </button>
              </li>
            ))
          ) : models.length > 0 ? (
            <li className="model-combobox-menu-status">没有匹配的模型</li>
          ) : error ? (
            <li className="model-combobox-menu-status">列表获取失败，可直接输入模型 ID，或点击刷新重试</li>
          ) : (
            <li className="model-combobox-menu-status">暂无可用模型，请刷新列表或直接输入模型 ID</li>
          )}
        </ul>
      )}

      {error ? (
        <p className="model-select-hint error">
          获取模型列表失败：{error}。可直接输入模型 ID，或点击刷新重试。
        </p>
      ) : null}
    </div>
  );
}
