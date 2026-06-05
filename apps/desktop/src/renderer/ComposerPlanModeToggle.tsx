import { shortenModelId } from "@eco/runtime";
import type { OrchestrationModeSetting } from "../shared/ipc";

interface ComposerPlanModeToggleProps {
  orchestrationMode: OrchestrationModeSetting;
  plannerModelId?: string | undefined;
  plannerTitle?: string | undefined;
  canEdit: boolean;
  saving?: boolean | undefined;
  onToggle: (mode: OrchestrationModeSetting) => void;
}

export function ComposerPlanModeToggle({
  orchestrationMode,
  plannerModelId,
  plannerTitle,
  canEdit,
  saving,
  onToggle,
}: ComposerPlanModeToggleProps) {
  const isManual = orchestrationMode === "manual";
  const clickable = canEdit && !saving;
  const className = [
    "composer-agent-model",
    "composer-plan-mode-toggle",
    isManual ? "is-active" : "is-inactive",
    clickable ? "is-clickable" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const modelShort = plannerModelId?.trim() ? shortenModelId(plannerModelId.trim()) : "—";
  const modelLabel = plannerTitle ?? modelShort;

  const tip = !canEdit
    ? isManual
      ? `手动编排 · ${modelLabel}（对话进行中不可改）`
      : `自主编排 · ${modelLabel}（对话进行中不可改）`
    : isManual
      ? `手动编排 · ${modelLabel} · 点击切到自主`
      : `自主编排 · ${modelLabel} · 点击切到手动`;

  const content = (
    <>
      <span className="composer-agent-model-role">{isManual ? "手动" : "自主"}</span>
      <span className="composer-agent-model-id">{modelShort}</span>
    </>
  );

  if (!clickable) {
    return (
      <span
        className={className}
        title={tip}
        aria-label={isManual ? `手动编排 · ${modelShort}` : `自主编排 · ${modelShort}`}
      >
        {content}
      </span>
    );
  }

  return (
    <button
      type="button"
      className={className}
      title={tip}
      disabled={saving}
      aria-pressed={isManual}
      aria-label={isManual ? `手动编排 · ${modelShort}` : `自主编排 · ${modelShort}`}
      onClick={() => onToggle(isManual ? "autonomous" : "manual")}
    >
      {content}
    </button>
  );
}
