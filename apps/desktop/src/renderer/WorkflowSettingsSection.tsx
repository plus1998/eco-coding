import type { OrchestrationModeSetting, WorkflowSettingsSnapshot } from "../shared/ipc";

interface WorkflowSettingsSectionProps {
  settings: WorkflowSettingsSnapshot;
  disabled?: boolean | undefined;
  onChange: (settings: WorkflowSettingsSnapshot) => void;
}

const MODE_OPTIONS: Array<{
  value: OrchestrationModeSetting;
  title: string;
  subtitle: string;
  description: string;
}> = [
  {
    value: "autonomous",
    title: "自主编排",
    subtitle: "autonomous",
    description: "主 Agent 按任务风险自选子代理；子代理默认全开，不可手动开关。",
  },
  {
    value: "manual",
    title: "手动编排",
    subtitle: "manual",
    description: "强制先计划后执行，走预设流水线；可在下方单独开关子代理。",
  },
];

export function WorkflowSettingsSection({ settings, disabled, onChange }: WorkflowSettingsSectionProps) {
  return (
    <section className="mcp-list-section models-plan-mode-section">
      <header className="models-section-header">
        <div className="models-section-intro">
          <h2 className="models-section-title">编排模式</h2>
          <p className="models-section-desc">仅影响新启动的对话。默认自主编排，由 Agent 决定子代理与是否提交计划。</p>
        </div>
      </header>
      <ul className="models-subagent-list">
        {MODE_OPTIONS.map((option) => {
          const active = settings.orchestrationMode === option.value;
          return (
            <li key={option.value}>
              <div
                className={
                  active
                    ? "models-subagent-card is-active models-plan-mode-card"
                    : "models-subagent-card is-inactive models-plan-mode-card"
                }
              >
                <div className="models-subagent-card-body">
                  <div className="models-subagent-card-title-row">
                    <span className="models-route-role">{option.title}</span>
                    <span className="models-route-role-id">{option.subtitle}</span>
                  </div>
                  <p className="models-subagent-card-desc">{option.description}</p>
                </div>
                <label className="mcp-toggle mcp-toggle-lg" title={active ? `${option.title}已选中` : `切换到${option.title}`}>
                  <input
                    type="radio"
                    name="orchestration-mode"
                    checked={active}
                    disabled={disabled}
                    onChange={() => onChange({ orchestrationMode: option.value })}
                  />
                  <span className="mcp-toggle-track" aria-hidden />
                </label>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
