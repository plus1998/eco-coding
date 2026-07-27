import { ChevronDown, LayoutTemplate, Settings2 } from "lucide-react";
import {
  type CSSProperties,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import type {
  MainAgentPromptSelection,
  ModelSettingsSnapshot,
  SubagentSelection,
  ThreadRuntimeConfig,
} from "../shared/ipc";
import { COMPOSER_TOOLBAR_ICON_PX, COMPOSER_TOOLBAR_ICON_STROKE } from "./composer-icon-metrics";

const POPOVER_WIDTH = 340;
const VIEWPORT_MARGIN = 8;
const ANCHOR_GAP = 8;
const MIN_POPOVER_HEIGHT = 120;
const BUILTIN_PROMPT_VALUE = "builtin";
const SUBAGENTS_NONE_VALUE = "__none__";

interface CompositionControlHandlers {
  onSelectMainAgentConfig: (id: string) => void | Promise<void>;
  onSelectMainPrompt: (selection: MainAgentPromptSelection) => void | Promise<void>;
  onSelectSubagents: (selection: SubagentSelection) => void | Promise<void>;
}

function mainPromptSelectionValue(selection: MainAgentPromptSelection | undefined): string {
  if (!selection) {
    return "";
  }
  return selection.mode === "builtin" ? BUILTIN_PROMPT_VALUE : selection.promptId;
}

function subagentSelectionValue(selection: SubagentSelection | undefined): string {
  if (!selection || selection.mode === "none") {
    return SUBAGENTS_NONE_VALUE;
  }
  return selection.orchestrationId;
}

function clampPopoverLeft(anchorLeft: number, width: number): number {
  const maxLeft = window.innerWidth - VIEWPORT_MARGIN - width;
  return Math.max(VIEWPORT_MARGIN, Math.min(anchorLeft, maxLeft));
}

function popoverStyleForAnchor(anchor: HTMLElement): CSSProperties {
  const rect = anchor.getBoundingClientRect();
  const width = Math.min(POPOVER_WIDTH, window.innerWidth - VIEWPORT_MARGIN * 2);
  const spaceAbove = rect.top - VIEWPORT_MARGIN;
  const maxHeight = Math.max(MIN_POPOVER_HEIGHT, spaceAbove - ANCHOR_GAP);
  return {
    position: "fixed",
    left: clampPopoverLeft(rect.left, width),
    bottom: window.innerHeight - rect.top + ANCHOR_GAP,
    width,
    maxHeight,
    zIndex: 10000,
  };
}

interface ComposerRoutePopoverProps extends CompositionControlHandlers {
  open: boolean;
  settings: ModelSettingsSnapshot;
  runtimeConfig?: ThreadRuntimeConfig | undefined;
  busy?: boolean | undefined;
  anchorRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  onOpenFullSettings: () => void;
}

interface ComposerRouteCardBodyProps extends CompositionControlHandlers {
  settings: ModelSettingsSnapshot;
  runtimeConfig?: ThreadRuntimeConfig | undefined;
  busy?: boolean | undefined;
  onOpenFullSettings: () => void;
}

export function ComposerRoutePopover({
  open,
  settings,
  runtimeConfig,
  busy,
  anchorRef,
  onClose,
  onSelectMainAgentConfig,
  onSelectMainPrompt,
  onSelectSubagents,
  onOpenFullSettings,
}: ComposerRoutePopoverProps) {
  const { t } = useTranslation();
  const panelRef = useRef<HTMLDivElement>(null);
  const [panelStyle, setPanelStyle] = useState<CSSProperties>(() => ({ visibility: "hidden" }));

  const updatePanelPosition = useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor) {
      return;
    }
    setPanelStyle(popoverStyleForAnchor(anchor));
  }, [anchorRef]);

  useLayoutEffect(() => {
    if (!open) {
      return;
    }
    updatePanelPosition();
    window.addEventListener("resize", updatePanelPosition);
    window.addEventListener("scroll", updatePanelPosition, true);
    return () => {
      window.removeEventListener("resize", updatePanelPosition);
      window.removeEventListener("scroll", updatePanelPosition, true);
    };
  }, [open, updatePanelPosition]);

  useEffect(() => {
    if (!open) {
      return;
    }
    function onClickOutside(event: MouseEvent) {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || anchorRef.current?.contains(target)) {
        return;
      }
      onClose();
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }
    document.addEventListener("click", onClickOutside);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("click", onClickOutside);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose, anchorRef]);

  if (!open) {
    return null;
  }

  return createPortal(
    <div
      ref={panelRef}
      className="composer-codex-popover composer-route-popover"
      role="dialog"
      aria-label={t("composer.route.switch")}
      style={panelStyle}
    >
      <header className="composer-route-popover-header">
        <p className="composer-codex-popover-title">{t("composer.route.profiles")}</p>
        <button
          type="button"
          className="composer-route-builder-button"
          disabled={busy}
          title={t("composer.route.openBuilder")}
          aria-label={t("composer.route.openBuilder")}
          onClick={() => {
            onClose();
            onOpenFullSettings();
          }}
        >
          <Settings2 size={15} strokeWidth={1.75} aria-hidden />
        </button>
      </header>
      <ComposerRouteCompositionControls
        settings={settings}
        runtimeConfig={runtimeConfig}
        disabled={busy}
        onSelectMainAgentConfig={onSelectMainAgentConfig}
        onSelectMainPrompt={onSelectMainPrompt}
        onSelectSubagents={onSelectSubagents}
      />
    </div>,
    document.body,
  );
}

export function ComposerRouteCardBody({
  settings,
  runtimeConfig,
  busy,
  onSelectMainAgentConfig,
  onSelectMainPrompt,
  onSelectSubagents,
  onOpenFullSettings,
}: ComposerRouteCardBodyProps) {
  const { t } = useTranslation();

  return (
    <div className="composer-route-card-body">
      <ComposerRouteCompositionControls
        settings={settings}
        runtimeConfig={runtimeConfig}
        disabled={busy}
        onSelectMainAgentConfig={onSelectMainAgentConfig}
        onSelectMainPrompt={onSelectMainPrompt}
        onSelectSubagents={onSelectSubagents}
      />
      <div className="composer-route-card-footer">
        <button
          type="button"
          className="composer-route-builder-button"
          disabled={busy}
          title={t("composer.route.openBuilder")}
          aria-label={t("composer.route.openBuilder")}
          onClick={onOpenFullSettings}
        >
          <Settings2 size={15} strokeWidth={1.75} aria-hidden />
          <span>{t("settings.models.builder")}</span>
        </button>
      </div>
    </div>
  );
}

function ComposerRouteCompositionControls({
  settings,
  runtimeConfig,
  disabled,
  onSelectMainAgentConfig,
  onSelectMainPrompt,
  onSelectSubagents,
}: {
  settings: ModelSettingsSnapshot;
  runtimeConfig?: ThreadRuntimeConfig | undefined;
  disabled?: boolean | undefined;
} & CompositionControlHandlers) {
  const mainAgentConfigs = settings.mainAgentConfigs ?? [];
  const mainAgentPrompts = (settings.mainAgentPrompts ?? []).filter(
    (prompt) => prompt.mode === "custom_append",
  );
  const subagentOrchestrations = settings.subagentOrchestrations ?? [];
  const selection = runtimeConfig?.orchestrationSelection;
  const selectedMainAgentConfigId = selection?.mainAgentConfigId ?? "";
  const mainAgentConfigId = mainAgentConfigs.some((config) => config.id === selectedMainAgentConfigId)
    ? selectedMainAgentConfigId
    : "";
  const selectedMainPromptValue = mainPromptSelectionValue(selection?.mainPrompt);
  const mainPromptValue =
    selectedMainPromptValue === BUILTIN_PROMPT_VALUE ||
    mainAgentPrompts.some((prompt) => prompt.id === selectedMainPromptValue)
      ? selectedMainPromptValue
      : "";
  const subagentsValue = subagentSelectionValue(selection?.subagents);
  const subagentOrchestrationId =
    subagentsValue !== SUBAGENTS_NONE_VALUE &&
    subagentOrchestrations.some((orchestration) => orchestration.id === subagentsValue)
      ? subagentsValue
      : subagentsValue === SUBAGENTS_NONE_VALUE
        ? SUBAGENTS_NONE_VALUE
        : "";

  return (
    <div className="composer-route-composition-controls">
      <div className="composer-route-prompt-control">
        <span className="composer-route-prompt-label">主代理</span>
        <select
          className="composer-route-prompt-segments"
          value={mainAgentConfigId}
          disabled={disabled || mainAgentConfigs.length === 0}
          onChange={(event) => void onSelectMainAgentConfig(event.target.value)}
        >
          {!mainAgentConfigId || mainAgentConfigs.length === 0 ? <option value="">未配置</option> : null}
          {mainAgentConfigs.map((config) => (
            <option key={config.id} value={config.id}>
              {config.name} ({config.modelRef.modelId})
            </option>
          ))}
        </select>
      </div>
      <div className="composer-route-prompt-control">
        <span className="composer-route-prompt-label">提示词</span>
        <select
          className="composer-route-prompt-segments"
          value={mainPromptValue}
          disabled={disabled}
          onChange={(event) => {
            const value = event.target.value;
            if (!value) {
              return;
            }
            void onSelectMainPrompt(
              value === BUILTIN_PROMPT_VALUE
                ? { mode: "builtin" }
                : { mode: "custom_append", promptId: value },
            );
          }}
        >
          {mainPromptValue ? null : <option value="">未配置</option>}
          <option value={BUILTIN_PROMPT_VALUE}>跟随 Agent 内置提示词</option>
          {mainAgentPrompts.map((prompt) => (
            <option key={prompt.id} value={prompt.id}>
              {prompt.name}
            </option>
          ))}
        </select>
      </div>
      <div className="composer-route-prompt-control">
        <span className="composer-route-prompt-label">子代理编排</span>
        <select
          className="composer-route-prompt-segments"
          value={subagentOrchestrationId}
          disabled={disabled}
          onChange={(event) => {
            const value = event.target.value;
            if (!value) {
              return;
            }
            void onSelectSubagents(
              value === SUBAGENTS_NONE_VALUE
                ? { mode: "none" }
                : { mode: "orchestration", orchestrationId: value },
            );
          }}
        >
          <option value={SUBAGENTS_NONE_VALUE}>不使用子代理</option>
          {subagentOrchestrations.map((orchestration) => (
            <option key={orchestration.id} value={orchestration.id}>
              {orchestration.name} ({orchestration.agents.length})
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

export function ComposerRoutePopoverTrigger({
  disabled,
  open,
  orchestrationName,
  buttonRef,
  compact,
  onToggle,
}: {
  disabled?: boolean | undefined;
  open: boolean;
  orchestrationName?: string | undefined;
  buttonRef: RefObject<HTMLButtonElement | null>;
  compact?: boolean | undefined;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  const label = orchestrationName?.trim() || t("composer.route.selectOrchestration");

  return (
    <button
      ref={buttonRef}
      type="button"
      className={[
        "composer-context-trigger",
        "composer-route-trigger",
        compact ? "is-compact" : "",
        open ? "is-active" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      onClick={onToggle}
      disabled={disabled}
      title={
        orchestrationName
          ? t("composer.route.currentOrchestration", { name: orchestrationName })
          : t("composer.route.switch")
      }
      aria-label={
        orchestrationName
          ? t("composer.route.currentOrchestrationSwitch", { name: orchestrationName })
          : t("composer.route.switch")
      }
      aria-expanded={open}
    >
      <LayoutTemplate
        size={COMPOSER_TOOLBAR_ICON_PX}
        strokeWidth={COMPOSER_TOOLBAR_ICON_STROKE}
        aria-hidden
        className="composer-context-trigger-icon"
      />
      <span
        className={
          orchestrationName
            ? "composer-context-trigger-label"
            : "composer-context-trigger-label is-placeholder"
        }
      >
        {label}
      </span>
      <ChevronDown size={14} aria-hidden className="composer-trigger-chevron" />
    </button>
  );
}
