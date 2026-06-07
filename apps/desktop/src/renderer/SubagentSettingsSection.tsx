import { SUBAGENT_ROLES, type SubagentEnabledSettings, type SubagentRole } from "../shared/ipc";

const ROLE_LABELS: Record<SubagentRole, string> = {
  explore: "探索",
  architect: "架构",
  coder: "编码",
  reviewer: "审查",
  tester: "测试",
};

const ROLE_HINTS: Record<SubagentRole, string> = {
  explore: "只读探索上下文，适合作为编排前置调查代理",
  architect: "拆分任务与结构设计，适合复杂变更前的方案代理",
  coder: "执行实现任务，默认编程预设中的必需代理",
  reviewer: "审查本次产物，适合风险较高的交付前检查",
  tester: "运行验证任务，适合交付前确认结果",
};

interface SubagentSettingsSectionProps {
  settings: SubagentEnabledSettings;
  saving?: boolean | undefined;
  disabled?: boolean | undefined;
  onChange: (settings: SubagentEnabledSettings) => void;
}

export function SubagentSettingsSection({
  settings,
  saving,
  disabled,
  onChange,
}: SubagentSettingsSectionProps) {
  function toggle(role: SubagentRole, enabled: boolean) {
    if (role === "coder") {
      return;
    }
    onChange({ ...settings, [role]: enabled });
  }

  return (
    <ul className="models-subagent-list">
      {SUBAGENT_ROLES.map((role) => {
        const enabled = settings[role];
        const locked = role === "coder";
        return (
          <li key={role}>
            <div
              className={
                enabled ? "models-subagent-card is-active" : "models-subagent-card is-inactive"
              }
            >
              <div className="models-subagent-card-body">
                <div className="models-subagent-card-title-row">
                  <span className="models-route-role">{ROLE_LABELS[role]}</span>
                  <span className="models-route-role-id">{role}</span>
                  {locked ? (
                    <span className="models-subagent-required-badge">默认必需</span>
                  ) : null}
                </div>
                <p className="models-subagent-card-desc">{ROLE_HINTS[role]}</p>
              </div>
              <label
                className="mcp-toggle mcp-toggle-lg"
                title={locked ? "默认编程执行子代理不可停用" : enabled ? "已启用" : "已停用"}
              >
                <input
                  type="checkbox"
                  checked={enabled}
                  disabled={disabled || saving || locked}
                  onChange={(event) => toggle(role, event.target.checked)}
                />
                <span className="mcp-toggle-track" aria-hidden />
              </label>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
