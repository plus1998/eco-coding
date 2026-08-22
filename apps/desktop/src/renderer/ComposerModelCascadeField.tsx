import { Check, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import {
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
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
import type { CommitModelOptionView } from "../shared/ipc";
import { CommitModelPricingCompact, CommitModelProviderDot } from "./CommitModelPricingCompact";
import {
  clampComposerFloatingLeft,
  composerFloatingAvailableWidth,
  composerFloatingPlacementViewportWidth,
} from "./composer-floating";

/** Minimal identity of an auxiliary/vision model selection. */
export interface ComposerModelSelection {
  providerId: string;
  modelId: string;
  candidateModelId: string;
}

interface ComposerModelCascadeFieldProps {
  value?: ComposerModelSelection | undefined;
  options: readonly CommitModelOptionView[];
  loading?: boolean | undefined;
  error?: string | undefined;
  disabled?: boolean | undefined;
  /** Allow clearing back to "not configured". */
  clearable?: boolean | undefined;
  /** Extra status text rendered under the trigger. */
  hint?: string | undefined;
  placeholder?: string | undefined;
  onChange: (selection: ComposerModelSelection | undefined) => void;
}

interface CascadeColumnRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
}

interface CascadeColumnPlacement {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
  overlay: boolean;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

function domRectValue(rect: DOMRect): CascadeColumnRect {
  return {
    left: rect.left,
    right: rect.right,
    top: rect.top,
    bottom: rect.bottom,
    width: rect.width,
    height: rect.height,
  };
}

/**
 * Positions a second-level column next to a first-level column, flipping to the
 * other side (or overlaying) when the viewport edge is reached.
 */
export function resolveCascadeColumnPlacement(input: {
  rootRect: CascadeColumnRect;
  anchorRect: CascadeColumnRect;
  viewportWidth: number;
  viewportHeight: number;
  preferredWidth: number;
  estimatedHeight: number;
  margin?: number;
  gap?: number;
}): CascadeColumnPlacement {
  const margin = input.margin ?? 8;
  const gap = input.gap ?? 2;
  const availableWidth = Math.max(160, input.viewportWidth - margin * 2);
  let width = Math.min(input.preferredWidth, availableWidth);
  const rightLeft = input.rootRect.right + gap;
  const leftLeft = input.rootRect.left - gap - width;
  const canOpenRight = rightLeft + width <= input.viewportWidth - margin;
  const canOpenLeft = leftLeft >= margin;
  let overlay = false;
  let left: number;
  if (canOpenRight) {
    left = rightLeft;
  } else if (canOpenLeft) {
    left = leftLeft;
  } else {
    overlay = true;
    width = Math.min(input.rootRect.width, availableWidth);
    left = clamp(input.rootRect.left, margin, input.viewportWidth - margin - width);
  }

  const desiredHeight = Math.min(input.estimatedHeight, input.viewportHeight - margin * 2);
  const maxTop = Math.max(margin, input.viewportHeight - margin - desiredHeight);
  const desiredTop = overlay ? input.rootRect.top : input.anchorRect.top - 6;
  const top = clamp(desiredTop, margin, maxTop);
  return {
    left,
    top,
    width,
    maxHeight: Math.max(72, input.viewportHeight - margin - top),
    overlay,
  };
}

function optionSelection(option: CommitModelOptionView): ComposerModelSelection {
  return {
    providerId: option.providerId,
    modelId: option.modelId,
    candidateModelId: option.candidateModelId,
  };
}

function findSelectionOption(
  options: readonly CommitModelOptionView[],
  selection: ComposerModelSelection | undefined,
): CommitModelOptionView | undefined {
  if (!selection) {
    return undefined;
  }
  return options.find(
    (option) =>
      option.candidateModelId === selection.candidateModelId ||
      (option.providerId === selection.providerId && option.modelId === selection.modelId),
  );
}

interface ProviderGroup {
  providerId: string;
  providerName: string;
  providerColor: string;
  options: CommitModelOptionView[];
}

function groupOptionsByProvider(options: readonly CommitModelOptionView[]): ProviderGroup[] {
  const groups = new Map<string, ProviderGroup>();
  for (const option of options) {
    let group = groups.get(option.providerId);
    if (!group) {
      group = {
        providerId: option.providerId,
        providerName: option.providerName,
        providerColor: option.providerColor,
        options: [],
      };
      groups.set(option.providerId, group);
    }
    group.options.push(option);
  }
  return [...groups.values()];
}

const TRIGGER_MIN_WIDTH = 160;
const PROVIDER_COLUMN_WIDTH = 228;
const MODEL_COLUMN_WIDTH = 284;
const ROW_HEIGHT = 30;
const HEADER_HEIGHT = 34;

export function ComposerModelCascadeField({
  value,
  options,
  loading,
  error,
  disabled,
  clearable,
  hint,
  placeholder,
  onChange,
}: ComposerModelCascadeFieldProps) {
  const { t } = useTranslation();
  const rootId = useId();
  const modelMenuId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const rootPanelRef = useRef<HTMLDivElement>(null);
  const modelPanelRef = useRef<HTMLDivElement>(null);
  const modelBackRef = useRef<HTMLButtonElement>(null);
  const providerButtonRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const modelButtonRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [open, setOpen] = useState(false);
  const [activeProviderId, setActiveProviderId] = useState<string | undefined>(undefined);
  const [focusedProviderIndex, setFocusedProviderIndex] = useState(0);
  const [focusedModelIndex, setFocusedModelIndex] = useState(0);
  const [rootPanelStyle, setRootPanelStyle] = useState<CSSProperties>(() => ({
    visibility: "hidden",
  }));
  const [modelPanelStyle, setModelPanelStyle] = useState<CSSProperties>(() => ({
    visibility: "hidden",
  }));
  const [modelPanelOverlay, setModelPanelOverlay] = useState(false);

  const providerGroups = useMemo(() => groupOptionsByProvider(options), [options]);
  const activeProvider =
    activeProviderId === undefined
      ? undefined
      : providerGroups.find((group) => group.providerId === activeProviderId);
  const activeProviderOptions = activeProvider?.options ?? [];

  const selectedOption = useMemo(() => findSelectionOption(options, value), [options, value]);
  const triggerLabel = selectedOption
    ? `${selectedOption.providerName} · ${selectedOption.modelLabel}`
    : (placeholder ?? t("composer.route.notConfigured"));
  const hasSelection = Boolean(selectedOption);
  const currentSelectionIndex = useMemo(() => {
    if (!selectedOption) {
      return undefined;
    }
    return providerGroups.findIndex((group) => group.providerId === selectedOption.providerId);
  }, [providerGroups, selectedOption]);
  const canClear = Boolean(clearable && hasSelection && !disabled);

  const updateRootPanelPosition = useCallback(() => {
    const anchor = triggerRef.current;
    if (!anchor) {
      return;
    }
    const rect = anchor.getBoundingClientRect();
    const margin = 8;
    const width = Math.min(
      PROVIDER_COLUMN_WIDTH,
      Math.max(TRIGGER_MIN_WIDTH, composerFloatingAvailableWidth(margin)),
    );
    const left = clampComposerFloatingLeft(rect.left, width, margin);
    const spaceAbove = rect.top - margin;
    const spaceBelow = window.innerHeight - rect.bottom - margin;
    const estimatedHeight = HEADER_HEIGHT + providerGroups.length * ROW_HEIGHT + ROW_HEIGHT;
    const minHeight = 120;
    const placeAbove = spaceAbove >= minHeight && spaceAbove >= spaceBelow;
    const availableSpace = Math.max(60, Math.floor(placeAbove ? spaceAbove : spaceBelow));
    const maxHeight = Math.min(estimatedHeight, availableSpace);
    setRootPanelStyle({
      position: "fixed",
      left,
      width,
      maxHeight,
      zIndex: 10000,
      ...(placeAbove ? { bottom: window.innerHeight - rect.top + 8 } : { top: rect.bottom + 8 }),
    });
  }, [providerGroups.length]);

  const updateModelPanelPosition = useCallback(() => {
    const rootPanel = rootPanelRef.current;
    // Anchor to the active provider row (hovered / opened), matching
    // ComposerModelSelector — not the currently committed selection, which
    // can be a different row and leaves the submenu visually detached.
    const activeIndex = activeProviderId
      ? providerGroups.findIndex((group) => group.providerId === activeProviderId)
      : -1;
    const anchor =
      activeIndex >= 0
        ? providerButtonRefs.current[activeIndex]
        : providerButtonRefs.current[focusedProviderIndex];
    if (!rootPanel || !anchor || !activeProvider) {
      return;
    }
    const itemCount = Math.max(activeProviderOptions.length, 1);
    const statusRows = loading || error || activeProviderOptions.length === 0 ? 1 : 0;
    const margin = 8;
    const placement = resolveCascadeColumnPlacement({
      rootRect: domRectValue(rootPanel.getBoundingClientRect()),
      anchorRect: domRectValue(anchor.getBoundingClientRect()),
      viewportWidth: composerFloatingPlacementViewportWidth(margin),
      viewportHeight: window.innerHeight,
      preferredWidth: MODEL_COLUMN_WIDTH,
      estimatedHeight: HEADER_HEIGHT + itemCount * ROW_HEIGHT + statusRows * ROW_HEIGHT,
    });
    setModelPanelStyle({
      position: "fixed",
      left: placement.left,
      top: placement.top,
      width: placement.width,
      maxHeight: placement.maxHeight,
      zIndex: 10001,
    });
    setModelPanelOverlay(placement.overlay);
  }, [
    activeProvider,
    activeProviderId,
    activeProviderOptions.length,
    error,
    focusedProviderIndex,
    loading,
    providerGroups,
  ]);

  const closePanel = useCallback((restoreFocus: boolean) => {
    setOpen(false);
    setActiveProviderId(undefined);
    if (restoreFocus) {
      requestAnimationFrame(() => triggerRef.current?.focus());
    }
  }, []);

  const openPanel = useCallback(() => {
    if (disabled) {
      return;
    }
    setActiveProviderId(undefined);
    setFocusedProviderIndex(currentSelectionIndex ?? 0);
    setFocusedModelIndex(0);
    updateRootPanelPosition();
    setOpen(true);
  }, [currentSelectionIndex, disabled, updateRootPanelPosition]);

  useLayoutEffect(() => {
    if (!open) {
      return;
    }
    const updatePositions = () => {
      updateRootPanelPosition();
      requestAnimationFrame(updateModelPanelPosition);
    };
    updateRootPanelPosition();
    window.addEventListener("resize", updatePositions);
    window.addEventListener("scroll", updatePositions, true);
    return () => {
      window.removeEventListener("resize", updatePositions);
      window.removeEventListener("scroll", updatePositions, true);
    };
  }, [open, updateModelPanelPosition, updateRootPanelPosition]);

  useLayoutEffect(() => {
    if (!open || !activeProvider) {
      return;
    }
    const frame = requestAnimationFrame(updateModelPanelPosition);
    return () => cancelAnimationFrame(frame);
  }, [activeProvider, open, updateModelPanelPosition]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const frame = requestAnimationFrame(() => providerButtonRefs.current[focusedProviderIndex]?.focus());
    return () => cancelAnimationFrame(frame);
  }, [focusedProviderIndex, open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    function handlePointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (
        rootPanelRef.current?.contains(target) ||
        modelPanelRef.current?.contains(target) ||
        triggerRef.current?.contains(target)
      ) {
        return;
      }
      closePanel(false);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        if (activeProvider) {
          setActiveProviderId(undefined);
          requestAnimationFrame(() => providerButtonRefs.current[focusedProviderIndex]?.focus());
        } else {
          closePanel(true);
        }
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
  }, [activeProvider, closePanel, focusedProviderIndex, open]);

  function openProviderAt(index: number) {
    const group = providerGroups[index];
    if (!group) {
      return;
    }
    setActiveProviderId(group.providerId);
    const modelIndex = selectedOption
      ? Math.max(
          0,
          group.options.findIndex((option) => option.candidateModelId === selectedOption.candidateModelId),
        )
      : 0;
    setFocusedModelIndex(modelIndex);
    requestAnimationFrame(() => modelButtonRefs.current[modelIndex]?.focus());
  }

  function focusProviderAt(index: number) {
    if (providerGroups.length === 0) {
      return;
    }
    const nextIndex = clamp(index, 0, providerGroups.length - 1);
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

  function commitModel(option: CommitModelOptionView) {
    onChange(optionSelection(option));
    closePanel(true);
  }

  function handleProviderKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusProviderAt(index === providerGroups.length - 1 ? 0 : index + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      focusProviderAt(index === 0 ? providerGroups.length - 1 : index - 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      focusProviderAt(0);
    } else if (event.key === "End") {
      event.preventDefault();
      focusProviderAt(providerGroups.length - 1);
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
      setActiveProviderId(undefined);
      requestAnimationFrame(() => providerButtonRefs.current[focusedProviderIndex]?.focus());
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      const option = activeProviderOptions[index];
      if (option) {
        commitModel(option);
      }
    }
  }

  const modelPanel = activeProvider ? (
    <div
      id={modelMenuId}
      ref={modelPanelRef}
      className={[
        "composer-codex-popover",
        "composer-cascade-field-submenu",
        modelPanelOverlay ? "is-overlay" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      role="menu"
      aria-label={activeProvider.providerName}
      style={modelPanelStyle}
    >
      <div className="composer-cascade-field-submenu-header">
        <button
          ref={modelBackRef}
          type="button"
          className="composer-cascade-field-submenu-back"
          aria-label={t("settings.back")}
          onClick={() => {
            setActiveProviderId(undefined);
            requestAnimationFrame(() => providerButtonRefs.current[focusedProviderIndex]?.focus());
          }}
        >
          <ChevronLeft size={14} aria-hidden />
        </button>
        <span className="composer-cascade-field-submenu-title">{activeProvider.providerName}</span>
      </div>
      <ul className="composer-cascade-field-submenu-list" role="none">
        {activeProviderOptions.map((option, index) => {
          const selected = selectedOption?.candidateModelId === option.candidateModelId;
          return (
            <li key={option.candidateModelId} role="none">
              <button
                ref={(node) => {
                  modelButtonRefs.current[index] = node;
                }}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                tabIndex={focusedModelIndex === index ? 0 : -1}
                className={
                  selected
                    ? "composer-cascade-field-submenu-item is-selected"
                    : "composer-cascade-field-submenu-item"
                }
                title={option.hint?.pricingLabel ?? `${option.providerName} · ${option.modelId}`}
                onKeyDown={(event) => handleModelKeyDown(event, index)}
                onClick={() => commitModel(option)}
              >
                <CommitModelProviderDot color={option.providerColor} label={option.providerName} />
                <span className="composer-cascade-field-submenu-label">{option.modelLabel}</span>
                <CommitModelPricingCompact hint={option.hint} />
                {selected ? <Check size={14} strokeWidth={2} aria-hidden /> : null}
              </button>
            </li>
          );
        })}
      </ul>
      {loading ? (
        <p className="composer-cascade-field-status" role="status">
          {t("composer.model.loading")}
        </p>
      ) : error ? (
        <p className="composer-cascade-field-status is-error" role="alert">
          {t("composer.model.loadFailed")}
        </p>
      ) : activeProviderOptions.length === 0 ? (
        <p className="composer-cascade-field-status">{t("composer.model.noCandidates")}</p>
      ) : null}
    </div>
  ) : null;

  const popover =
    open &&
    createPortal(
      <>
        <div
          id={rootId}
          ref={rootPanelRef}
          className="composer-codex-popover composer-cascade-field-menu"
          role="menu"
          aria-label={t("composer.route.auxiliaryModel")}
          style={rootPanelStyle}
        >
          <div className="composer-cascade-field-menu-header">
            <span className="composer-cascade-field-menu-title">{t("composer.model.provider")}</span>
          </div>
          {providerGroups.length > 0 ? (
            <ul className="composer-cascade-field-menu-list" role="none">
              {providerGroups.map((group, index) => {
                const active = activeProviderId === group.providerId;
                const selected = selectedOption?.providerId === group.providerId;
                return (
                  <li key={group.providerId} role="none">
                    <button
                      ref={(node) => {
                        providerButtonRefs.current[index] = node;
                      }}
                      type="button"
                      role="menuitem"
                      aria-haspopup="menu"
                      aria-expanded={active}
                      aria-controls={modelMenuId}
                      tabIndex={focusedProviderIndex === index ? 0 : -1}
                      className={
                        active
                          ? "composer-cascade-field-menu-item is-active"
                          : "composer-cascade-field-menu-item"
                      }
                      onMouseEnter={() => {
                        setActiveProviderId(group.providerId);
                        setFocusedProviderIndex(index);
                      }}
                      onFocus={() => setFocusedProviderIndex(index)}
                      onKeyDown={(event) => handleProviderKeyDown(event, index)}
                      onClick={() => openProviderAt(index)}
                    >
                      <CommitModelProviderDot color={group.providerColor} label={group.providerName} />
                      <span className="composer-cascade-field-menu-label">{group.providerName}</span>
                      <span className="composer-cascade-field-menu-count">{group.options.length}</span>
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
          {loading ? (
            <p className="composer-cascade-field-status" role="status">
              {t("composer.model.loading")}
            </p>
          ) : error ? (
            <p className="composer-cascade-field-status is-error" role="alert">
              {t("composer.model.loadFailed")}
            </p>
          ) : providerGroups.length === 0 ? (
            <p className="composer-cascade-field-status">{t("composer.model.noCandidates")}</p>
          ) : null}
          {canClear ? (
            <button
              type="button"
              className="composer-cascade-field-clear"
              onClick={() => {
                onChange(undefined);
                closePanel(true);
              }}
            >
              {t("composer.model.restoreDefault")}
            </button>
          ) : null}
        </div>
        {modelPanel}
      </>,
      document.body,
    );

  return (
    <span className="composer-cascade-field">
      <button
        ref={triggerRef}
        type="button"
        className={[
          "composer-cascade-field-trigger",
          open ? "is-active" : "",
          hasSelection ? "has-selection" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        disabled={disabled || (loading && !hasSelection)}
        aria-label={triggerLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={rootId}
        title={hint ?? triggerLabel}
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
        {selectedOption ? (
          <CommitModelProviderDot color={selectedOption.providerColor} label={selectedOption.providerName} />
        ) : null}
        <span
          className={
            hasSelection
              ? "composer-cascade-field-trigger-label"
              : "composer-cascade-field-trigger-label is-placeholder"
          }
        >
          {loading && !hasSelection ? t("composer.model.loading") : triggerLabel}
        </span>
        <ChevronDown
          size={14}
          aria-hidden
          className={open ? "composer-cascade-field-chevron is-open" : "composer-cascade-field-chevron"}
        />
      </button>
      {popover}
    </span>
  );
}
