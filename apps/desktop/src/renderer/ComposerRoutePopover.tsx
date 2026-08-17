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
  AuxiliaryModelSelection,
  CommitModelOptionView,
  MainAgentPromptSelection,
  ModelSettingsSnapshot,
  SubagentSelection,
  ThreadRuntimeConfig,
  VisionModelSelection,
} from "../shared/ipc";
import { ComposerModelCascadeField } from "./ComposerModelCascadeField";
import { ComposerFieldSelect } from "./ComposerFieldSelect";
import { COMPOSER_TOOLBAR_ICON_PX, COMPOSER_TOOLBAR_ICON_STROKE } from "./composer-icon-metrics";
import type { OrchestrationFieldIssue, OrchestrationFieldKey } from "./orchestration-readiness";
import { orchestrationIssueDetailKey } from "./orchestration-readiness";

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
  onSelectAuxiliaryModel: (selection: AuxiliaryModelSelection) => void | Promise<void>;
  onSelectVisionModel: (selection: VisionModelSelection) => void | Promise<void>;
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
  canEdit?: boolean | undefined;
  showOrchestration?: boolean | undefined;
  invalidFields?: readonly OrchestrationFieldKey[] | undefined;
  orchestrationIssues?: readonly OrchestrationFieldIssue[] | undefined;
  anchorRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  onOpenFullSettings: () => void;
}

interface ComposerRouteCardBodyProps extends CompositionControlHandlers {
  settings: ModelSettingsSnapshot;
  runtimeConfig?: ThreadRuntimeConfig | undefined;
  busy?: boolean | undefined;
  canEdit?: boolean | undefined;
  showOrchestration?: boolean | undefined;
  invalidFields?: readonly OrchestrationFieldKey[] | undefined;
  orchestrationIssues?: readonly OrchestrationFieldIssue[] | undefined;
  onOpenFullSettings: () => void;
}

export function ComposerRoutePopover({
  open,
  settings,
  runtimeConfig,
  busy,
  canEdit = true,
  showOrchestration = true,
  invalidFields,
  orchestrationIssues,
  anchorRef,
  onClose,
  onSelectMainAgentConfig,
  onSelectMainPrompt,
  onSelectSubagents,
  onSelectAuxiliaryModel,
  onSelectVisionModel,
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
      setPanelStyle({ visibility: "hidden" });
      return;
    }
    updatePanelPosition();
    // Re-measure after paint in case the anchor ref attaches a frame late.
    const raf = window.requestAnimationFrame(() => updatePanelPosition());
    window.addEventListener("resize", updatePanelPosition);
    window.addEventListener("scroll", updatePanelPosition, true);
    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener("resize", updatePanelPosition);
      window.removeEventListener("scroll", updatePanelPosition, true);
    };
  }, [open, updatePanelPosition]);

  useEffect(() => {
    if (!open) {
      return;
    }
    function onPointerDownOutside(event: MouseEvent) {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || anchorRef.current?.contains(target)) {
        return;
      }
      // Nested ComposerFieldSelect / ComposerModelCascadeField menus portal to
      // document.body; treat them as inside so selecting an option does not
      // dismiss this popover before the value can commit.
      if (
        target instanceof Element &&
        target.closest(
          ".composer-field-select-menu, .composer-cascade-field-menu, .composer-cascade-field-submenu",
        )
      ) {
        return;
      }
      onClose();
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }
    // Defer so the opening click cannot immediately dismiss the popover.
    const listenerTimer = window.setTimeout(() => {
      document.addEventListener("mousedown", onPointerDownOutside);
    }, 0);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.clearTimeout(listenerTimer);
      document.removeEventListener("mousedown", onPointerDownOutside);
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
          disabled={busy || !canEdit}
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
        disabled={busy || !canEdit}
        showOrchestration={showOrchestration}
        invalidFields={invalidFields}
        orchestrationIssues={orchestrationIssues}
        onSelectMainAgentConfig={onSelectMainAgentConfig}
        onSelectMainPrompt={onSelectMainPrompt}
        onSelectSubagents={onSelectSubagents}
        onSelectAuxiliaryModel={onSelectAuxiliaryModel}
        onSelectVisionModel={onSelectVisionModel}
      />
    </div>,
    document.body,
  );
}

export function ComposerRouteCardBody({
  settings,
  runtimeConfig,
  busy,
  canEdit = false,
  showOrchestration = true,
  invalidFields,
  orchestrationIssues,
  onSelectMainAgentConfig,
  onSelectMainPrompt,
  onSelectSubagents,
  onSelectAuxiliaryModel,
  onSelectVisionModel,
  onOpenFullSettings,
}: ComposerRouteCardBodyProps) {
  const { t } = useTranslation();

  return (
    <div className="composer-route-card-body">
      <ComposerRouteCompositionControls
        settings={settings}
        runtimeConfig={runtimeConfig}
        disabled={busy || !canEdit}
        showOrchestration={showOrchestration}
        invalidFields={invalidFields}
        orchestrationIssues={orchestrationIssues}
        onSelectMainAgentConfig={onSelectMainAgentConfig}
        onSelectMainPrompt={onSelectMainPrompt}
        onSelectSubagents={onSelectSubagents}
        onSelectAuxiliaryModel={onSelectAuxiliaryModel}
        onSelectVisionModel={onSelectVisionModel}
      />
      <div className="composer-route-card-footer">
        <button
          type="button"
          className="composer-route-builder-button"
          disabled={busy || !canEdit}
          title={t("composer.route.openBuilder")}
          aria-label={t("composer.route.openBuilder")}
          onClick={onOpenFullSettings}
        >
          <Settings2 size={15} strokeWidth={1.75} aria-hidden />
                <span>{t("settings.orchestrationComponents")}</span>
        </button>
      </div>
    </div>
  );
}

function ComposerRouteCompositionControls({
  settings,
  runtimeConfig,
  disabled,
  showOrchestration = true,
  invalidFields,
  orchestrationIssues,
  onSelectMainAgentConfig,
  onSelectMainPrompt,
  onSelectSubagents,
  onSelectAuxiliaryModel,
  onSelectVisionModel,
}: {
  settings: ModelSettingsSnapshot;
  runtimeConfig?: ThreadRuntimeConfig | undefined;
  disabled?: boolean | undefined;
  showOrchestration?: boolean | undefined;
  invalidFields?: readonly OrchestrationFieldKey[] | undefined;
  orchestrationIssues?: readonly OrchestrationFieldIssue[] | undefined;
} & CompositionControlHandlers) {
  const { t } = useTranslation();
  const mainAgentConfigs = settings.mainAgentConfigs ?? [];
  const mainAgentPrompts = (settings.mainAgentPrompts ?? []).filter(
    (prompt) => prompt.mode === "custom_append",
  );
  const subagentOrchestrations = settings.subagentOrchestrations ?? [];
  const [auxiliaryModelOptions, setAuxiliaryModelOptions] = useState<CommitModelOptionView[]>([]);
  const [auxiliaryModelsLoading, setAuxiliaryModelsLoading] = useState(false);
  const [auxiliaryModelsError, setAuxiliaryModelsError] = useState<string>();
  const selection = runtimeConfig?.orchestrationSelection;
  const selectedMainAgentConfigId = selection?.mainAgentConfigId ?? "";
  const mainAgentConfigId = mainAgentConfigs.some((config) => config.id === selectedMainAgentConfigId)
    ? selectedMainAgentConfigId
    : "";
  const mainAgentInvalid = Boolean(invalidFields?.includes("mainAgent"));
  const subagentOrchestrationInvalid = Boolean(invalidFields?.includes("subagentOrchestration"));
  const mainAgentIssue = orchestrationIssues?.find((issue) => issue.field === "mainAgent");
  const subagentIssue = orchestrationIssues?.find((issue) => issue.field === "subagentOrchestration");
  const mainAgentInvalidLabel = mainAgentIssue
    ? t(orchestrationIssueDetailKey(mainAgentIssue), {
        name: mainAgentIssue.mainAgentConfigName || t("composer.route.mainAgent"),
        provider: mainAgentIssue.providerName,
      }).replace(/^[:：]\s*/, "")
    : t("composer.route.fieldInvalid");
  const subagentInvalidLabel = subagentIssue
    ? t(orchestrationIssueDetailKey(subagentIssue), {
        orchestration: subagentIssue.orchestrationName || t("composer.route.subagentOrchestration"),
        agent: subagentIssue.agentKey
          ? t(`agent.role.${subagentIssue.agentKey}`, { defaultValue: subagentIssue.agentKey })
          : "",
        provider: subagentIssue.providerName,
      }).replace(/^[:：]\s*/, "")
    : t("composer.route.fieldInvalid");
  useEffect(() => {
    if (!window.eco) {
      setAuxiliaryModelOptions([]);
      setAuxiliaryModelsLoading(false);
      setAuxiliaryModelsError(undefined);
      return;
    }
    let cancelled = false;
    setAuxiliaryModelsLoading(true);
    setAuxiliaryModelsError(undefined);
    void window.eco
      .listGitCommitModelOptions(mainAgentConfigId ? { mainAgentConfigId } : {})
      .then((result) => {
        if (!cancelled) {
          setAuxiliaryModelOptions(result.options);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setAuxiliaryModelOptions([]);
          setAuxiliaryModelsError(error instanceof Error ? error.message : String(error));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setAuxiliaryModelsLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [mainAgentConfigId]);
  const auxiliaryHint = showOrchestration
    ? t("composer.route.auxiliaryModelHint")
    : t("composer.route.auxiliaryModelHintAcp");
  const visionHint = showOrchestration
    ? t("composer.route.visionModelHint")
    : t("composer.route.visionModelHintAcp");
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
      {showOrchestration ? (
        <div className="composer-route-prompt-control">
          <span className="composer-route-prompt-label">{t("composer.route.mainAgent")}</span>
          <ComposerFieldSelect
            value={mainAgentConfigId}
            disabled={disabled || mainAgentConfigs.length === 0}
            showPlaceholder
            placeholder={t("composer.route.notConfigured")}
            invalid={mainAgentInvalid}
            invalidLabel={mainAgentInvalidLabel}
            onChange={(value) => void onSelectMainAgentConfig(value)}
          >
            {mainAgentConfigs.map((config) => (
              <option key={config.id} value={config.id}>
                {config.name} ({config.modelRef.modelId})
              </option>
            ))}
          </ComposerFieldSelect>
        </div>
      ) : null}
      <div className="composer-route-prompt-control">
        <span className="composer-route-prompt-label">{t("composer.route.auxiliaryModel")}</span>
        <ComposerModelCascadeField
          value={runtimeConfig?.auxiliaryModel}
          options={auxiliaryModelOptions}
          loading={auxiliaryModelsLoading}
          error={auxiliaryModelsError}
          disabled={disabled}
          hint={auxiliaryHint}
          onChange={(selection) => {
            if (selection) {
              void onSelectAuxiliaryModel(selection);
            }
          }}
        />
        <span className="composer-route-prompt-hint">{auxiliaryHint}</span>
      </div>
      <div className="composer-route-prompt-control">
        <span className="composer-route-prompt-label">{t("composer.route.visionModel")}</span>
        <ComposerModelCascadeField
          value={runtimeConfig?.visionModel}
          options={auxiliaryModelOptions}
          loading={auxiliaryModelsLoading}
          error={auxiliaryModelsError}
          disabled={disabled}
          hint={visionHint}
          onChange={(selection) => {
            if (selection) {
              void onSelectVisionModel(selection);
            }
          }}
        />
        <span className="composer-route-prompt-hint">{visionHint}</span>
      </div>
      {showOrchestration ? (
        <>
          <div className="composer-route-prompt-control">
            <span className="composer-route-prompt-label">{t("composer.route.prompt")}</span>
            <ComposerFieldSelect
              value={mainPromptValue}
              disabled={disabled}
              showPlaceholder
              placeholder={t("composer.route.notConfigured")}
              onChange={(value) => {
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
              <option value={BUILTIN_PROMPT_VALUE}>{t("composer.route.defaultBuiltinPrompt")}</option>
              {mainAgentPrompts.map((prompt) => (
                <option key={prompt.id} value={prompt.id}>
                  {prompt.name}
                </option>
              ))}
            </ComposerFieldSelect>
          </div>
          <div className="composer-route-prompt-control">
            <span className="composer-route-prompt-label">{t("composer.route.subagentOrchestration")}</span>
            <ComposerFieldSelect
              value={subagentOrchestrationId}
              disabled={disabled}
              invalid={subagentOrchestrationInvalid}
              invalidLabel={subagentInvalidLabel}
              onChange={(value) => {
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
              <option value={SUBAGENTS_NONE_VALUE}>{t("composer.route.noSubagents")}</option>
              {subagentOrchestrations.map((orchestration) => (
                <option key={orchestration.id} value={orchestration.id}>
                  {orchestration.name} ({orchestration.agents.length})
                </option>
              ))}
            </ComposerFieldSelect>
          </div>
        </>
      ) : null}
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
