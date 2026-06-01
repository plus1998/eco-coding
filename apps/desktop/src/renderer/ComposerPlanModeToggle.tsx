import { shortenModelId } from "@eco/runtime";

interface ComposerPlanModeToggleProps {
  planModeEnabled: boolean;
  plannerModelId?: string | undefined;
  plannerTitle?: string | undefined;
  canEdit: boolean;
  saving?: boolean | undefined;
  onToggle: (enabled: boolean) => void;
}

export function ComposerPlanModeToggle({
  planModeEnabled,
  plannerModelId,
  plannerTitle,
  canEdit,
  saving,
  onToggle,
}: ComposerPlanModeToggleProps) {
  const clickable = canEdit && !saving;
  const className = [
    "composer-agent-model",
    "composer-plan-mode-toggle",
    planModeEnabled ? "is-active" : "is-inactive",
    clickable ? "is-clickable" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const modelShort = plannerModelId?.trim() ? shortenModelId(plannerModelId.trim()) : "—";
  const modelLabel = plannerTitle ?? modelShort;

  const tip = !canEdit
    ? planModeEnabled
      ? `计划模式已开启 · ${modelLabel}（对话进行中不可改）`
      : `直接编码 · ${modelLabel}（对话进行中不可改）`
    : planModeEnabled
      ? `计划模式已开启 · ${modelLabel} · 点击关闭`
      : `直接编码 · ${modelLabel} · 点击开启`;

  const content = (
    <>
      <span className="composer-agent-model-role">计划</span>
      <span className="composer-agent-model-id">{modelShort}</span>
    </>
  );

  if (!clickable) {
    return (
      <span
        className={className}
        title={tip}
        aria-label={planModeEnabled ? `计划模式已开启 · ${modelShort}` : `计划模式已关闭 · ${modelShort}`}
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
      aria-pressed={planModeEnabled}
      aria-label={planModeEnabled ? `计划模式已开启 · ${modelShort}` : `计划模式已关闭 · ${modelShort}`}
      onClick={() => onToggle(!planModeEnabled)}
    >
      {content}
    </button>
  );
}
