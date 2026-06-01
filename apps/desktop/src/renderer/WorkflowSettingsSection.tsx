import type { WorkflowSettingsSnapshot } from "../shared/ipc";

interface WorkflowSettingsSectionProps {
  settings: WorkflowSettingsSnapshot;
  disabled?: boolean | undefined;
  onChange: (settings: WorkflowSettingsSnapshot) => void;
}

export function WorkflowSettingsSection({ settings, disabled, onChange }: WorkflowSettingsSectionProps) {
  const enabled = settings.planModeEnabled;

  return (
    <section className="mcp-list-section models-plan-mode-section">
      <header className="models-section-header">
        <div className="models-section-intro">
          <h2 className="models-section-title">计划模式</h2>
          <p className="models-section-desc">
            仅影响新启动的对话。开启时先探索并生成计划、经你确认后再执行；关闭时使用 Claude Code
            预设由主会话直接编码。与子代理开关无关。
          </p>
        </div>
      </header>
      <div
        className={
          enabled ? "models-subagent-card is-active models-plan-mode-card" : "models-subagent-card is-inactive models-plan-mode-card"
        }
      >
        <div className="models-subagent-card-body">
          <div className="models-subagent-card-title-row">
            <span className="models-route-role">{enabled ? "先计划后执行" : "直接编码"}</span>
            <span className="models-route-role-id">{enabled ? "plan" : "claude_code"}</span>
          </div>
          <p className="models-subagent-card-desc">
            {enabled
              ? "探索代码库 → AskUserQuestion → 计划确认 → 按已启用子代理走执行流水线。"
              : "单次会话、无计划确认；主会话按 Claude Code 预设调度下方已启用的子代理。"}
          </p>
        </div>
        <label className="mcp-toggle mcp-toggle-lg" title={enabled ? "计划模式已开启" : "计划模式已关闭"}>
          <input
            type="checkbox"
            checked={enabled}
            disabled={disabled}
            onChange={(event) => onChange({ planModeEnabled: event.target.checked })}
          />
          <span className="mcp-toggle-track" aria-hidden />
        </label>
      </div>
    </section>
  );
}
