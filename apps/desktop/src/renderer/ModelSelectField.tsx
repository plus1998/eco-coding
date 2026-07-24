import { ChevronDown, RefreshCw } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation();
  const listboxId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const filteredModels = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
      return models;
    }
    return models.filter((model) => {
      const id = model.id.toLowerCase();
      const name = model.displayName?.toLowerCase() ?? "";
      return id.includes(normalizedQuery) || name.includes(normalizedQuery);
    });
  }, [models, query]);

  useEffect(() => {
    if (!open) {
      setQuery("");
    }
  }, [open]);

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

  function openModelList() {
    if (disabled || loading) {
      return;
    }
    setQuery("");
    setOpen(true);
    if (models.length === 0 && onRefresh && !error) {
      onRefresh();
    }
  }

  function toggleDropdown() {
    if (disabled || loading) {
      return;
    }
    if (open) {
      setOpen(false);
      return;
    }
    openModelList();
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
            placeholder={t("modelSelect.placeholder")}
            role="combobox"
            aria-expanded={open}
            aria-controls={listboxId}
            aria-autocomplete="list"
            onChange={(event) => {
              const nextValue = event.target.value;
              onChange(nextValue);
              if (open) {
                setQuery(nextValue);
              }
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown" && !open) {
                event.preventDefault();
                openModelList();
              }
            }}
          />
          <button
            type="button"
            className="model-combobox-toggle"
            aria-label={open ? t("modelSelect.collapse") : t("modelSelect.expand")}
            aria-expanded={open}
            aria-controls={listboxId}
            disabled={disabled || loading}
            onClick={toggleDropdown}
          >
            <ChevronDown
              size={16}
              className={open ? "model-combobox-chevron is-open" : "model-combobox-chevron"}
            />
          </button>
        </div>
        {onRefresh && (
          <button
            type="button"
            className="model-refresh-button"
            aria-label={t("modelSelect.refresh")}
            disabled={disabled || loading}
            onClick={onRefresh}
          >
            <RefreshCw size={16} className={loading ? "model-refresh-spin" : undefined} />
          </button>
        )}
      </div>

      {open && (
        <div id={listboxId} className="model-combobox-menu" role="listbox">
          {loading ? (
            <div className="model-combobox-menu-status">{t("modelSelect.loading")}</div>
          ) : filteredModels.length > 0 ? (
            filteredModels.map((model) => (
              <div key={model.id}>
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
              </div>
            ))
          ) : models.length > 0 ? (
            <div className="model-combobox-menu-status">{t("modelSelect.noMatch")}</div>
          ) : error ? (
            <div className="model-combobox-menu-status">{t("modelSelect.loadFailedHint")}</div>
          ) : (
            <div className="model-combobox-menu-status">{t("modelSelect.emptyHint")}</div>
          )}
        </div>
      )}

      {error ? (
        <p className="model-select-hint error">
          {t("modelSelect.errorDetail", { error })}
        </p>
      ) : null}
    </div>
  );
}
