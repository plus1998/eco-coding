import { SUBAGENT_ROLES, type SubagentEnabledSettings, type SubagentRole } from "../shared/ipc";

const ROLE_LABELS: Record<SubagentRole, string> = {
  explore: "探索",
  architect: "架构",
  coder: "编码",
  reviewer: "审查",
  tester: "测试",
};

const ROLE_HINTS: Record<SubagentRole, string> = {
  explore: "只读浏览代码库，规划/问答阶段可调用",
  architect: "拆分任务与架构建议",
  coder: "实现代码（流水线必需）",
  reviewer: "审查本次改动",
  tester: "运行测试验证",
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
                    <span className="models-subagent-required-badge">流水线必需</span>
                  ) : null}
                </div>
                <p className="models-subagent-card-desc">{ROLE_HINTS[role]}</p>
              </div>
              <label
                className="mcp-toggle mcp-toggle-lg"
                title={locked ? "编码子代理不可关闭" : enabled ? "已启用" : "已关闭"}
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
