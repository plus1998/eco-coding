import { ChevronDown } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { ModelsDevMapping, ModelsDevModelOption } from "../shared/ipc";

interface ModelsDevModelSelectFieldProps {
  value?: ModelsDevMapping | undefined;
  options: readonly ModelsDevModelOption[];
  loading?: boolean | undefined;
  disabled?: boolean | undefined;
  autoResolved?: boolean | undefined;
  autoResolvedMapping?: ModelsDevMapping | undefined;
  autoResolvedLabel?: string | undefined;
  onChange: (mapping: ModelsDevMapping | undefined) => void;
}

function encodeMapping(mapping: ModelsDevMapping): string {
  return `${mapping.providerKey}::${mapping.modelId}`;
}

function formatMappingLabel(mapping: ModelsDevMapping, options: readonly ModelsDevModelOption[]): string {
  const match = options.find(
    (option) => option.providerKey === mapping.providerKey && option.modelId === mapping.modelId,
  );
  if (match) {
    return `${match.displayName} · ${mapping.providerKey}/${mapping.modelId}`;
  }
  return `${mapping.providerKey}/${mapping.modelId}`;
}

function mappingEquals(left?: ModelsDevMapping, right?: ModelsDevMapping): boolean {
  return Boolean(
    left &&
      right &&
      left.providerKey === right.providerKey &&
      left.modelId === right.modelId,
  );
}

export function ModelsDevModelSelectField({
  value,
  options,
  loading,
  disabled,
  autoResolved,
  autoResolvedMapping,
  autoResolvedLabel,
  onChange,
}: ModelsDevModelSelectFieldProps) {
  const listboxId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const manualLabel = value ? formatMappingLabel(value, options) : "";
  const autoLabel =
    autoResolvedMapping && autoResolved
      ? (autoResolvedLabel ?? formatMappingLabel(autoResolvedMapping, options))
      : "";
  const closedDisplayValue = manualLabel || autoLabel;
  const displayValue = open ? query : closedDisplayValue;

  const filteredOptions = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return options.slice(0, 120);
    }
    return options
      .filter((option) => {
        const haystack = `${option.displayName} ${option.providerKey} ${option.modelId}`.toLowerCase();
        return haystack.includes(normalized);
      })
      .slice(0, 120);
  }, [options, query]);

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

  function selectAuto() {
    onChange(undefined);
    setOpen(false);
    setQuery("");
    inputRef.current?.blur();
  }

  function selectOption(option: ModelsDevModelOption) {
    onChange({ providerKey: option.providerKey, modelId: option.modelId });
    setOpen(false);
    setQuery("");
    inputRef.current?.blur();
  }

  const autoMatchSummary =
    autoResolved && autoResolvedMapping
      ? (autoResolvedLabel ?? formatMappingLabel(autoResolvedMapping, options))
      : undefined;

  return (
    <div className="model-select-field models-dev-select-field" ref={rootRef}>
      <div className="model-combobox-row">
        <div className={`model-combobox-input-wrap${open ? " is-open" : ""}`}>
          <input
            ref={inputRef}
            type="text"
            className={`mcp-field-input model-combobox-input${!value && autoLabel ? " models-dev-select-auto" : ""}`}
            value={displayValue}
            disabled={disabled}
            placeholder="自动匹配（未命中时可选手动映射）"
            role="combobox"
            aria-expanded={open}
            aria-controls={listboxId}
            aria-autocomplete="list"
            onChange={(event) => {
              setQuery(event.target.value);
              if (!open) {
                setOpen(true);
              }
            }}
            onFocus={() => {
              if (!disabled && !loading) {
                setOpen(true);
              }
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown" && !open) {
                event.preventDefault();
                setOpen(true);
              }
            }}
          />
          <button
            type="button"
            className="model-combobox-toggle"
            aria-label={open ? "收起 models.dev 列表" : "展开 models.dev 列表"}
            aria-expanded={open}
            aria-controls={listboxId}
            disabled={disabled || loading}
            onClick={() => setOpen((current) => !current)}
          >
            <ChevronDown size={16} className={open ? "model-combobox-chevron is-open" : "model-combobox-chevron"} />
          </button>
        </div>
      </div>

      {open && (
        <ul id={listboxId} className="model-combobox-menu" role="listbox">
          <li>
            <button
              type="button"
              role="option"
              aria-selected={!value}
              className={`model-combobox-option${!value ? " is-selected" : ""}`}
              onMouseDown={(event) => event.preventDefault()}
              onClick={selectAuto}
            >
              <span className="model-combobox-option-label">
                自动匹配
                {autoMatchSummary ? ` · 当前命中 ${autoMatchSummary}` : " · 按上游模型 id 推断"}
              </span>
            </button>
          </li>
          {loading ? (
            <li className="model-combobox-menu-status">加载 models.dev 目录…</li>
          ) : filteredOptions.length > 0 ? (
            filteredOptions.map((option) => {
              const optionMapping = { providerKey: option.providerKey, modelId: option.modelId };
              const selected =
                mappingEquals(value, optionMapping) ||
                (!value && mappingEquals(autoResolvedMapping, optionMapping) && Boolean(autoResolved));
              return (
                <li key={encodeMapping(optionMapping)}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={selected}
                    className={`model-combobox-option${selected ? " is-selected" : ""}`}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => selectOption(option)}
                  >
                    <span className="model-combobox-option-label">
                      {option.displayName} · {option.providerKey}/{option.modelId}
                      {!value && mappingEquals(autoResolvedMapping, optionMapping) && autoResolved
                        ? " · 自动命中"
                        : ""}
                    </span>
                  </button>
                </li>
              );
            })
          ) : (
            <li className="model-combobox-menu-status">没有匹配的 models.dev 模型</li>
          )}
        </ul>
      )}

      {value ? (
        <p className="models-dev-select-hint">手动映射：{manualLabel}</p>
      ) : autoMatchSummary ? (
        <p className="models-dev-select-hint">自动命中：{autoMatchSummary}</p>
      ) : autoResolved === false ? (
        <p className="models-dev-select-hint unresolved">未自动匹配，可手动选择 models.dev 模型</p>
      ) : null}
    </div>
  );
}

export { encodeMapping };
