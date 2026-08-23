import { Check, ChevronDown, ChevronRight, Search, X } from "lucide-react";
import {
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { CommitModelProviderDot } from "./CommitModelPricingCompact";
import { composerFloatingStyleForAnchor } from "./composer-floating";

/**
 * Unified "provider → model" selection.
 *
 * Every place that lets the user pick from the full model catalogue renders
 * this single component: a provider/model hierarchy with a search box on
 * top. Options are never listed flat — the left column always groups them
 * by provider, and the search box filters within that hierarchy.
 */
export interface ModelCascadeOption {
  /** Stable unique key (candidate id, or `provider::model`). */
  key: string;
  providerId: string;
  providerName: string;
  providerColor?: string | undefined;
  /** Optional image asset for the provider (rendered instead of the color dot). */
  providerIcon?: string | undefined;
  modelId: string;
  /** Primary display label of the model row. */
  label: string;
  /** Optional secondary line (model id, etc.). */
  description?: string | undefined;
}

export interface ModelCascadeSelection {
  key?: string | undefined;
  providerId: string;
  modelId: string;
}

interface ModelCascadeSelectProps {
  options: readonly ModelCascadeOption[];
  value?: ModelCascadeSelection | undefined;
  /**
   * Optional "active but not committed" selection (e.g. an auto-matched
   * models.dev entry). Rendered with a muted check mark.
   */
  secondaryValue?: ModelCascadeSelection | undefined;
  onChange: (selection: ModelCascadeSelection | undefined) => void;
  loading?: boolean | undefined;
  error?: string | undefined;
  disabled?: boolean | undefined;
  /** Show a "clear" row (auto / restore default). */
  clearable?: boolean | undefined;
  /**
   * Label for the clear row. When provided the row is visible even without a
   * committed value (e.g. "auto-match" as the default state).
   */
  clearLabel?: string | undefined;
  placeholder?: string | undefined;
  /** Tooltip for the trigger. */
  hint?: string | undefined;
  /** Extra node appended to each model row (e.g. pricing). */
  renderExtra?: ((option: ModelCascadeOption) => ReactNode) | undefined;
  /** Node rendered below the trigger (status hints, etc.). */
  footer?: ReactNode;
  /** Stacking context for the portaled panel (e.g. inside modal dialogs). */
  panelZIndex?: number | undefined;
  /** Extra class for the trigger button (e.g. composer sizing). */
  triggerClassName?: string | undefined;
  /** Called once when the panel opens. */
  onOpen?: (() => void) | undefined;
  /** Pre-fill the search box the next time the panel opens. */
  initialQuery?: string | undefined;
  /** Fixed panel height in px (clamped to available space). */
  fixedHeight?: number | undefined;
}

interface ProviderGroup {
  providerId: string;
  providerName: string;
  providerColor?: string | undefined;
  providerIcon?: string | undefined;
  options: ModelCascadeOption[];
}

export function groupModelCascadeOptions(
  options: readonly ModelCascadeOption[],
): ProviderGroup[] {
  const groups = new Map<string, ProviderGroup>();
  for (const option of options) {
    let group = groups.get(option.providerId);
    if (!group) {
      group = {
        providerId: option.providerId,
        providerName: option.providerName,
        providerColor: option.providerColor,
        providerIcon: option.providerIcon,
        options: [],
      };
      groups.set(option.providerId, group);
    }
    group.options.push(option);
  }
  return [...groups.values()];
}

/**
 * Search filter for the cascade hierarchy: a provider group stays visible
 * when its name matches or any of its models match; otherwise only the
 * matching models are listed. Groups without any match are hidden — the
 * catalogue is never rendered flat across providers.
 */
export function filterModelCascadeGroups(
  groups: readonly ProviderGroup[],
  query: string,
): ProviderGroup[] {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return groups.map((group) => ({ ...group, options: [...group.options] }));
  }
  return groups
    .map((group) => {
      const providerMatches =
        group.providerName.toLowerCase().includes(needle) ||
        group.providerId.toLowerCase().includes(needle);
      const matchedOptions = group.options.filter(
        (option) =>
          providerMatches ||
          option.label.toLowerCase().includes(needle) ||
          option.modelId.toLowerCase().includes(needle),
      );
      return {
        ...group,
        options: providerMatches ? [...group.options] : matchedOptions,
      };
    })
    .filter((group) => group.options.length > 0);
}

function renderProviderBadge(group: Pick<ProviderGroup, "providerId" | "providerName" | "providerColor" | "providerIcon">) {
  if (group.providerIcon) {
    return (
      <img
        className="model-cascade-provider-icon"
        src={group.providerIcon}
        alt=""
        aria-hidden="true"
      />
    );
  }
  return (
    <CommitModelProviderDot
      color={group.providerColor ?? "transparent"}
      label={group.providerName}
    />
  );
}

function optionMatchesSelection(
  option: ModelCascadeOption,
  selection: ModelCascadeSelection | undefined,
): boolean {
  if (!selection) {
    return false;
  }
  if (selection.key && option.key) {
    return selection.key === option.key;
  }
  return option.providerId === selection.providerId && option.modelId === selection.modelId;
}

function findOption(
  options: readonly ModelCascadeOption[],
  selection: ModelCascadeSelection | undefined,
): ModelCascadeOption | undefined {
  if (!selection) {
    return undefined;
  }
  return options.find((option) => optionMatchesSelection(option, selection));
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

const PANEL_PREFERRED_WIDTH = 476;
const PANEL_MIN_HEIGHT = 160;

export function ModelCascadeSelect({
  options,
  value,
  secondaryValue,
  onChange,
  loading,
  error,
  disabled,
  clearable,
  clearLabel,
  placeholder,
  hint,
  renderExtra,
  footer,
  panelZIndex,
  triggerClassName,
  onOpen,
  initialQuery,
  fixedHeight,
}: ModelCascadeSelectProps) {
  const { t } = useTranslation();
  const panelId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const providerButtonRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const modelButtonRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(initialQuery ?? "");
  const [activeProviderId, setActiveProviderId] = useState<string | undefined>(undefined);
  const [focusedProviderIndex, setFocusedProviderIndex] = useState(0);
  const [focusedModelIndex, setFocusedModelIndex] = useState(0);
  const [panelStyle, setPanelStyle] = useState<CSSProperties>(() => ({
    visibility: "hidden",
  }));

  const providerGroups = useMemo(() => groupModelCascadeOptions(options), [options]);

  const needle = query.trim().toLowerCase();
  const visibleGroups = useMemo(
    () => filterModelCascadeGroups(providerGroups, query),
    [providerGroups, query],
  );

  const activeProvider =
    activeProviderId === undefined
      ? undefined
      : visibleGroups.find((group) => group.providerId === activeProviderId);
  const activeProviderOptions = activeProvider?.options ?? [];

  const selectedOption = useMemo(() => findOption(options, value), [options, value]);
  const secondaryOption = useMemo(() => findOption(options, secondaryValue), [options, secondaryValue]);
  const hasSelection = Boolean(value && selectedOption);
  const triggerLabel = selectedOption
    ? `${selectedOption.providerName} · ${selectedOption.label}`
    : (placeholder ?? t("modelCascade.placeholder"));

  const showClearRow = Boolean(clearable) && (hasSelection || clearLabel !== undefined);
  const clearText = clearLabel ?? t("composer.model.restoreDefault");

  const updatePanelPosition = useCallback(() => {
    const anchor = triggerRef.current;
    if (!anchor) {
      return;
    }
    const style = composerFloatingStyleForAnchor(anchor, {
      width: PANEL_PREFERRED_WIDTH,
      minHeight: PANEL_MIN_HEIGHT,
      prefer: "auto",
      ...(fixedHeight !== undefined ? { fixedHeight } : {}),
    });
    if (panelZIndex !== undefined) {
      style.zIndex = panelZIndex;
    }
    setPanelStyle(style);
  }, [fixedHeight, panelZIndex]);

  const closePanel = useCallback((restoreFocus: boolean) => {
    setOpen(false);
    setQuery("");
    if (restoreFocus) {
      requestAnimationFrame(() => triggerRef.current?.focus());
    }
  }, []);

  const openPanel = useCallback(() => {
    if (disabled) {
      return;
    }
    onOpen?.();
    setQuery(initialQuery ?? "");
    const selectedProviderId = selectedOption?.providerId;
    const firstGroup = providerGroups[0];
    const fallbackProviderId =
      providerGroups.find((group) => group.providerId === selectedProviderId)?.providerId ??
      firstGroup?.providerId;
    setActiveProviderId(fallbackProviderId);
    setFocusedProviderIndex(0);
    setFocusedModelIndex(0);
    updatePanelPosition();
    setOpen(true);
  }, [disabled, initialQuery, onOpen, providerGroups, selectedOption, updatePanelPosition]);

  useLayoutEffect(() => {
    if (!open) {
      return;
    }
    const updateViewportPositions = () => updatePanelPosition();
    updatePanelPosition();
    window.addEventListener("resize", updateViewportPositions);
    window.addEventListener("scroll", updateViewportPositions, true);
    return () => {
      window.removeEventListener("resize", updateViewportPositions);
      window.removeEventListener("scroll", updateViewportPositions, true);
    };
  }, [open, updatePanelPosition]);

  // Keep the active provider valid while the query filters the catalogue.
  useEffect(() => {
    if (!open) {
      return;
    }
    if (activeProviderId && visibleGroups.some((group) => group.providerId === activeProviderId)) {
      return;
    }
    const selectedProviderId = selectedOption?.providerId;
    const fallback =
      visibleGroups.find((group) => group.providerId === selectedProviderId)?.providerId ??
      visibleGroups[0]?.providerId;
    setActiveProviderId(fallback);
  }, [activeProviderId, open, selectedOption, visibleGroups]);

  // Clamp focused indices when the visible list shrinks.
  useEffect(() => {
    if (!open) {
      return;
    }
    if (focusedProviderIndex >= visibleGroups.length) {
      setFocusedProviderIndex(Math.max(0, visibleGroups.length - 1));
    }
    if (focusedModelIndex >= activeProviderOptions.length) {
      setFocusedModelIndex(Math.max(0, activeProviderOptions.length - 1));
    }
  }, [activeProviderOptions.length, focusedModelIndex, focusedProviderIndex, open, visibleGroups.length]);

  // Focus the search box when the panel opens.
  useEffect(() => {
    if (!open) {
      return;
    }
    const frame = requestAnimationFrame(() => searchInputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    function handlePointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (
        panelRef.current?.contains(target) ||
        triggerRef.current?.contains(target)
      ) {
        return;
      }
      closePanel(false);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        if (query.trim()) {
          setQuery("");
          return;
        }
        closePanel(true);
      } else if (event.key === "Tab") {
        closePanel(false);
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [closePanel, open, query]);

  function focusProviderAt(index: number) {
    if (visibleGroups.length === 0) {
      return;
    }
    const nextIndex = clamp(index, 0, visibleGroups.length - 1);
    setFocusedProviderIndex(nextIndex);
    requestAnimationFrame(() => providerButtonRefs.current[nextIndex]?.focus());
  }

  function focusModelAt(index: number) {
    if (activeProviderOptions.length === 0) {
      return;
    }
    const nextIndex = clamp(index, 0, activeProviderOptions.length - 1);
    setFocusedModelIndex(nextIndex);
    requestAnimationFrame(() => modelButtonRefs.current[nextIndex]?.focus());
  }

  function openProviderAt(index: number) {
    const group = visibleGroups[index];
    if (!group) {
      return;
    }
    setActiveProviderId(group.providerId);
    const selectedIndex = selectedOption
      ? group.options.findIndex((option) => optionMatchesSelection(option, value))
      : -1;
    setFocusedModelIndex(selectedIndex >= 0 ? selectedIndex : 0);
    requestAnimationFrame(() =>
      modelButtonRefs.current[selectedIndex >= 0 ? selectedIndex : 0]?.focus(),
    );
  }

  function focusActiveProvider() {
    if (!activeProviderId) {
      return;
    }
    const index = visibleGroups.findIndex((group) => group.providerId === activeProviderId);
    if (index >= 0) {
      setFocusedProviderIndex(index);
      requestAnimationFrame(() => providerButtonRefs.current[index]?.focus());
    }
  }

  function commitModel(option: ModelCascadeOption) {
    onChange({ key: option.key, providerId: option.providerId, modelId: option.modelId });
    closePanel(true);
  }

  function clearSelection() {
    onChange(undefined);
    closePanel(true);
  }

  function handleSearchKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Home") {
      event.preventDefault();
      focusProviderAt(0);
    } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      // Stay in the input; nothing to move to.
    } else if (event.key === "Enter") {
      event.preventDefault();
      const group = activeProvider;
      const onlyOption = group && group.options.length === 1 ? group.options[0] : undefined;
      if (onlyOption) {
        commitModel(onlyOption);
      }
    }
  }

  function handleProviderKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusProviderAt(index === visibleGroups.length - 1 ? 0 : index + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      focusProviderAt(index === 0 ? visibleGroups.length - 1 : index - 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      focusProviderAt(0);
    } else if (event.key === "End") {
      event.preventDefault();
      focusProviderAt(visibleGroups.length - 1);
    } else if (event.key === "ArrowRight" || event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openProviderAt(index);
    }
  }

  function handleModelKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusModelAt(index === activeProviderOptions.length - 1 ? 0 : index + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      focusModelAt(index === 0 ? activeProviderOptions.length - 1 : index - 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      focusModelAt(0);
    } else if (event.key === "End") {
      event.preventDefault();
      focusModelAt(activeProviderOptions.length - 1);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      focusActiveProvider();
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      const option = activeProviderOptions[index];
      if (option) {
        commitModel(option);
      }
    }
  }

  const statusNode = loading ? (
    <p className="model-cascade-status" role="status">
      {t("composer.model.loading")}
    </p>
  ) : error ? (
    <p className="model-cascade-status is-error" role="alert">
      {t("composer.model.loadFailed")}
    </p>
  ) : providerGroups.length === 0 ? (
    <p className="model-cascade-status">{t("composer.model.noCandidates")}</p>
  ) : needle && visibleGroups.length === 0 ? (
    <p className="model-cascade-status">{t("modelCascade.noMatch")}</p>
  ) : null;

  const popover =
    open &&
    createPortal(
      <div
        id={panelId}
        ref={panelRef}
        className="composer-codex-popover model-cascade-panel"
        style={panelStyle}
      >
        <label className="model-cascade-search">
          <Search size={14} aria-hidden />
          <input
            ref={searchInputRef}
            type="search"
            value={query}
            placeholder={t("modelCascade.search")}
            aria-label={t("modelCascade.search")}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleSearchKeyDown}
          />
          {query ? (
            <button
              type="button"
              className="model-cascade-search-clear"
              aria-label={t("common.close")}
              onClick={() => {
                setQuery("");
                searchInputRef.current?.focus();
              }}
            >
              <X size={12} aria-hidden />
            </button>
          ) : null}
        </label>
        {showClearRow ? (
          <button
            type="button"
            className={`model-cascade-clear${!value ? " is-active" : ""}`}
            onClick={clearSelection}
          >
            <span className="model-cascade-clear-label">{clearText}</span>
            {!value ? <Check size={14} strokeWidth={2} aria-hidden /> : null}
          </button>
        ) : null}
        <div className="model-cascade-columns">
          <div className="model-cascade-provider-col">
            <div className="model-cascade-col-title">
              <span className="model-cascade-col-title-text">{t("modelCascade.providers")}</span>
            </div>
            {visibleGroups.length > 0 ? (
              <ul className="model-cascade-provider-list">
                {visibleGroups.map((group, index) => {
                  const active = activeProviderId === group.providerId;
                  const selected = selectedOption?.providerId === group.providerId;
                  return (
                    <li key={group.providerId}>
                      <button
                        ref={(node) => {
                          providerButtonRefs.current[index] = node;
                        }}
                        type="button"
                        className={
                          active
                            ? "model-cascade-provider-item is-active"
                            : "model-cascade-provider-item"
                        }
                        tabIndex={focusedProviderIndex === index ? 0 : -1}
                        aria-expanded={active}
                        aria-label={`${group.providerName} (${group.options.length})`}
                        onMouseEnter={() => {
                          setActiveProviderId(group.providerId);
                          setFocusedProviderIndex(index);
                        }}
                        onFocus={() => setFocusedProviderIndex(index)}
                        onKeyDown={(event) => handleProviderKeyDown(event, index)}
                        onClick={() => openProviderAt(index)}
                      >
                        {renderProviderBadge(group)}
                        <span className="model-cascade-item-label">{group.providerName}</span>
                        <span className="model-cascade-count">{group.options.length}</span>
                        {selected ? (
                          <Check size={14} strokeWidth={2} aria-hidden />
                        ) : (
                          <ChevronRight size={14} aria-hidden />
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </div>
          <div className="model-cascade-model-col">
            <div className="model-cascade-col-title">
              <span className="model-cascade-col-title-text">
                {activeProvider ? activeProvider.providerName : t("modelCascade.models")}
              </span>
            </div>
            {activeProviderOptions.length > 0 ? (
              <ul className="model-cascade-model-list">
                {activeProviderOptions.map((option, index) => {
                  const selected = optionMatchesSelection(option, value);
                  const secondary = !selected && optionMatchesSelection(option, secondaryValue);
                  return (
                    <li key={option.key}>
                      <button
                        ref={(node) => {
                          modelButtonRefs.current[index] = node;
                        }}
                        type="button"
                        className={
                          selected
                            ? "model-cascade-model-item is-selected"
                            : "model-cascade-model-item"
                        }
                        tabIndex={focusedModelIndex === index ? 0 : -1}
                        title={`${option.providerName} · ${option.modelId}`}
                        onKeyDown={(event) => handleModelKeyDown(event, index)}
                        onClick={() => commitModel(option)}
                      >
                        <span className="model-cascade-model-label">
                          <span className="model-cascade-model-title">{option.label}</span>
                          {option.description ? (
                            <span className="model-cascade-model-desc">{option.description}</span>
                          ) : null}
                        </span>
                        {renderExtra?.(option)}
                        {selected ? (
                          <Check size={14} strokeWidth={2} aria-hidden />
                        ) : secondary ? (
                          <Check size={14} strokeWidth={2} className="is-secondary" aria-hidden />
                        ) : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </div>
        </div>
        {statusNode}
      </div>,
      document.body,
    );

  return (
    <span className="model-cascade">
      <button
        ref={triggerRef}
        type="button"
        className={[
          "model-cascade-trigger",
          triggerClassName,
          open ? "is-active" : "",
          hasSelection ? "has-selection" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        disabled={disabled || (loading && !hasSelection)}
        aria-label={triggerLabel}
        title={hint ?? triggerLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onKeyDown={(event) => {
          if (!open && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
            event.preventDefault();
            openPanel();
          }
        }}
        onClick={() => {
          if (open) {
            closePanel(false);
          } else {
            openPanel();
          }
        }}
      >
        {selectedOption ? renderProviderBadge(selectedOption) : null}
        <span
          className={
            hasSelection
              ? "model-cascade-trigger-label"
              : "model-cascade-trigger-label is-placeholder"
          }
        >
          {loading && !hasSelection ? t("composer.model.loading") : triggerLabel}
        </span>
        <ChevronDown
          size={14}
          aria-hidden
          className={open ? "model-cascade-chevron is-open" : "model-cascade-chevron"}
        />
      </button>
      {popover}
      {footer}
    </span>
  );
}
