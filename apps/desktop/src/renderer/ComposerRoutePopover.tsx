import { Check, ChevronDown, LayoutTemplate, Settings2 } from "lucide-react";
import {
  type CSSProperties,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import type { ModelSettingsSnapshot, ThreadRuntimeConfig } from "../shared/ipc";
import {
  type MainAgentSystemPromptPreset,
  resolveMainAgentSystemPromptPreset,
} from "../shared/thread-runtime-config";
import { type AgentProfileSummary, listSelectableAgentProfileSummaries } from "./agent-profile-summary";
import { ComposerModelLabel } from "./ComposerModelLabel";
import { COMPOSER_TOOLBAR_ICON_PX, COMPOSER_TOOLBAR_ICON_STROKE } from "./composer-icon-metrics";

const POPOVER_WIDTH = 420;
const VIEWPORT_MARGIN = 8;
const ANCHOR_GAP = 8;
const MIN_POPOVER_HEIGHT = 120;

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

interface ComposerRoutePopoverProps {
  open: boolean;
  settings: ModelSettingsSnapshot;
  selectedProfileId?: string | undefined;
  runtimeConfig?: ThreadRuntimeConfig | undefined;
  busy?: boolean | undefined;
  anchorRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  onSelectProfile: (profileId: string) => void | Promise<void>;
  onSelectSystemPromptPreset: (preset: MainAgentSystemPromptPreset) => void | Promise<void>;
  onOpenFullSettings: () => void;
}

export function ComposerRoutePopover({
  open,
  settings,
  selectedProfileId,
  runtimeConfig,
  busy,
  anchorRef,
  onClose,
  onSelectProfile,
  onSelectSystemPromptPreset,
  onOpenFullSettings,
}: ComposerRoutePopoverProps) {
  const { t } = useTranslation();
  const panelRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const selectedOptionRef = useRef<HTMLButtonElement>(null);
  const [panelStyle, setPanelStyle] = useState<CSSProperties>(() => ({ visibility: "hidden" }));
  const [listMaxHeight, setListMaxHeight] = useState<number>();
  const profileSummaries = useMemo(
    () => listSelectableAgentProfileSummaries(settings, runtimeConfig),
    [settings, runtimeConfig],
  );
  const selectedProfile = useMemo(
    () =>
      settings.orchestrationProfiles.find(
        (profile) => profile.id === (runtimeConfig?.agentProfileId ?? runtimeConfig?.routeProfileId),
      ),
    [settings.orchestrationProfiles, runtimeConfig?.agentProfileId, runtimeConfig?.routeProfileId],
  );
  const selectedSystemPromptPreset =
    selectedProfile && runtimeConfig
      ? resolveMainAgentSystemPromptPreset(selectedProfile, runtimeConfig)
      : undefined;

  const updateListMaxHeight = useCallback(() => {
    const list = listRef.current;
    if (!list) {
      setListMaxHeight((current) => (current === undefined ? current : undefined));
      return;
    }
    const items = Array.from(list.children) as HTMLElement[];
    if (items.length === 0) {
      setListMaxHeight((current) => (current === undefined ? current : undefined));
      return;
    }
    const visibleCount = Math.min(2, items.length);
    let height = 0;
    for (let index = 0; index < visibleCount; index += 1) {
      const item = items[index];
      if (item) {
        height += item.getBoundingClientRect().height;
      }
    }
    if (visibleCount > 1) {
      const styles = getComputedStyle(list);
      const gap = Number.parseFloat(styles.rowGap || styles.gap || "0") || 0;
      height += gap * (visibleCount - 1);
    }
    const nextHeight = Math.ceil(height);
    setListMaxHeight((current) => (current === nextHeight ? current : nextHeight));
  }, []);

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

  useLayoutEffect(() => {
    if (!open) {
      return;
    }
    if (profileSummaries.length === 0) {
      updateListMaxHeight();
      return;
    }
    updateListMaxHeight();
  }, [open, profileSummaries, updateListMaxHeight]);

  useLayoutEffect(() => {
    const list = listRef.current;
    const selected = selectedOptionRef.current;
    if (!open || listMaxHeight === undefined || !list || !selected) {
      return;
    }
    const listRect = list.getBoundingClientRect();
    const selectedRect = selected.getBoundingClientRect();
    list.scrollTop = Math.max(
      0,
      list.scrollTop + selectedRect.top - listRect.top - (list.clientHeight - selectedRect.height) / 2,
    );
  }, [open, listMaxHeight]);

  useEffect(() => {
    if (open) {
      return;
    }
    setListMaxHeight((current) => (current === undefined ? current : undefined));
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    function onPointerDown(event: MouseEvent) {
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
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
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
      <ul
        ref={listRef}
        className="composer-route-popover-list"
        style={listMaxHeight === undefined ? undefined : { maxHeight: listMaxHeight }}
      >
        {profileSummaries.map((summary) => (
          <AgentProfileOption
            key={summary.selectionId}
            summary={summary}
            selected={summary.selectionId === selectedProfileId}
            buttonRef={summary.selectionId === selectedProfileId ? selectedOptionRef : undefined}
            disabled={busy}
            onSelect={() => {
              if (summary.selectionId) {
                void onSelectProfile(summary.selectionId);
              }
            }}
          />
        ))}
      </ul>
      {profileSummaries.length === 0 ? (
        <p className="composer-route-popover-empty">{t("composer.route.empty")}</p>
      ) : null}
      {selectedSystemPromptPreset ? (
        <SystemPromptPresetControl
          value={selectedSystemPromptPreset}
          disabled={busy}
          onChange={onSelectSystemPromptPreset}
        />
      ) : null}
    </div>,
    document.body,
  );
}

export function ComposerRouteCardBody({
  settings,
  selectedProfileId,
  runtimeConfig,
  busy,
  onSelectProfile,
  onSelectSystemPromptPreset,
  onOpenFullSettings,
}: {
  settings: ModelSettingsSnapshot;
  selectedProfileId?: string | undefined;
  runtimeConfig?: ThreadRuntimeConfig | undefined;
  busy?: boolean | undefined;
  onSelectProfile: (profileId: string) => void | Promise<void>;
  onSelectSystemPromptPreset: (preset: MainAgentSystemPromptPreset) => void | Promise<void>;
  onOpenFullSettings: () => void;
}) {
  const { t } = useTranslation();
  const profileSummaries = listSelectableAgentProfileSummaries(settings, runtimeConfig);
  const selectedProfile = settings.orchestrationProfiles.find(
    (profile) => profile.id === (runtimeConfig?.agentProfileId ?? runtimeConfig?.routeProfileId),
  );
  const selectedSystemPromptPreset =
    selectedProfile && runtimeConfig
      ? resolveMainAgentSystemPromptPreset(selectedProfile, runtimeConfig)
      : undefined;

  return (
    <div className="composer-route-card-body">
      <ul className="composer-route-popover-list">
        {profileSummaries.map((summary) => (
          <AgentProfileOption
            key={summary.selectionId}
            summary={summary}
            selected={summary.selectionId === selectedProfileId}
            disabled={busy}
            onSelect={() => {
              if (summary.selectionId) {
                void onSelectProfile(summary.selectionId);
              }
            }}
          />
        ))}
      </ul>
      {profileSummaries.length === 0 ? (
        <p className="composer-route-popover-empty">{t("composer.route.empty")}</p>
      ) : null}
      {selectedSystemPromptPreset ? (
        <SystemPromptPresetControl
          value={selectedSystemPromptPreset}
          disabled={busy}
          onChange={onSelectSystemPromptPreset}
        />
      ) : null}
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

function SystemPromptPresetControl({
  value,
  disabled,
  onChange,
}: {
  value: MainAgentSystemPromptPreset;
  disabled?: boolean | undefined;
  onChange: (preset: MainAgentSystemPromptPreset) => void | Promise<void>;
}) {
  const { t } = useTranslation();
  return (
    <div className="composer-route-prompt-control">
      <span className="composer-route-prompt-label">{t("composer.route.mainPrompt")}</span>
      <div className="composer-route-prompt-segments" role="radiogroup" aria-label={t("composer.route.mainPrompt")}>
        <label className={value === "core_native" ? "active" : undefined} title={t("composer.route.followPromptHint")}>
          <input
            type="radio"
            name="composer-main-agent-system-prompt"
            value="core_native"
            checked={value === "core_native"}
            disabled={disabled}
            onChange={() => void onChange("core_native")}
          />
          <span>{t("settings.models.editor.followAgent")}</span>
        </label>
        <label className={value === "custom_append" ? "active" : undefined} title={t("composer.route.customPromptHint")}>
          <input
            type="radio"
            name="composer-main-agent-system-prompt"
            value="custom_append"
            checked={value === "custom_append"}
            disabled={disabled}
            onChange={() => void onChange("custom_append")}
          />
          <span>{t("composer.route.profileInstructions")}</span>
        </label>
      </div>
    </div>
  );
}

function AgentProfileOption({
  summary,
  selected,
  buttonRef,
  disabled,
  onSelect,
}: {
  summary: AgentProfileSummary;
  selected: boolean;
  buttonRef?: RefObject<HTMLButtonElement | null> | undefined;
  disabled?: boolean | undefined;
  onSelect: () => void;
}) {
  const { t } = useTranslation();
  const subagentPreview = summary.enabledAgents.slice(0, 2);
  const hiddenSubagentCount = Math.max(0, summary.enabledAgents.length - subagentPreview.length);
  const riskPreview = summary.highRiskLabels.slice(0, 2);
  const hiddenRiskCount = Math.max(0, summary.highRiskLabels.length - riskPreview.length);
  const modelRows = [
    {
      key: "main",
      role: t("settings.models.mainAgent"),
      modelId: summary.main.modelId,
      thinkingEffort: summary.main.thinkingEffort,
    },
    ...subagentPreview.map((agent) => ({
      key: agent.agentKey,
      role: agent.name,
      modelId: agent.modelId,
      thinkingEffort: agent.thinkingEffort,
    })),
  ];
  const riskText =
    riskPreview.length > 0
      ? t("composer.route.highRisk", {
          risks: riskPreview.join(t("composer.route.listSeparator")),
          more:
            hiddenRiskCount > 0
              ? t("composer.route.moreRiskItems", {
                  count: riskPreview.length + hiddenRiskCount,
                })
              : "",
        })
      : null;

  return (
    <li>
      <button
        ref={buttonRef}
        type="button"
        className={selected ? "composer-codex-popover-item active" : "composer-codex-popover-item"}
        disabled={disabled || selected}
        aria-pressed={selected}
        onClick={onSelect}
      >
        <span className="composer-route-profile-card">
          <span className="composer-route-profile-head">
            <span className="composer-route-popover-item-name">{summary.name}</span>
            <span className="composer-route-profile-meta">
              {t("composer.route.profileMeta", {
                preset: summary.presetLabel,
                count: summary.enabledAgents.length,
              })}
            </span>
          </span>

          <span className="composer-route-profile-models">
            {modelRows.map((row) => (
              <span key={row.key} className="composer-route-profile-model-row">
                <span className="composer-route-profile-model-role">{row.role}</span>
                <span className="composer-route-profile-model-name" title={row.modelId}>
                  <ComposerModelLabel
                    modelId={row.modelId}
                    thinkingEffort={row.thinkingEffort}
                    size="small"
                  />
                </span>
              </span>
            ))}
            {hiddenSubagentCount > 0 ? (
              <span className="composer-route-profile-model-row is-more">
                <span className="composer-route-profile-model-role" aria-hidden />
                <span className="composer-route-profile-model-name">
                  {t("composer.route.moreSubagents", { count: hiddenSubagentCount })}
                </span>
              </span>
            ) : null}
          </span>

          {riskText ? <span className="composer-route-profile-risks">{riskText}</span> : null}
        </span>

        <span
          className={
            selected ? "composer-codex-popover-check" : "composer-codex-popover-check is-placeholder"
          }
          aria-hidden
        >
          <Check size={14} strokeWidth={2.25} />
        </span>
      </button>
    </li>
  );
}

export function ComposerRoutePopoverTrigger({
  disabled,
  open,
  profileName,
  buttonRef,
  compact,
  onToggle,
}: {
  disabled?: boolean | undefined;
  open: boolean;
  profileName?: string | undefined;
  buttonRef: RefObject<HTMLButtonElement | null>;
  compact?: boolean | undefined;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  const label = profileName?.trim() || t("composer.route.selectProfile");

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
        profileName
          ? t("composer.route.currentProfile", { name: profileName })
          : t("composer.route.switch")
      }
      aria-label={
        profileName
          ? t("composer.route.currentProfileSwitch", { name: profileName })
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
          profileName ? "composer-context-trigger-label" : "composer-context-trigger-label is-placeholder"
        }
      >
        {label}
      </span>
      <ChevronDown size={14} aria-hidden className="composer-trigger-chevron" />
    </button>
  );
}
