import { RefreshCw, Sparkles } from "lucide-react";
import type { SkillInfo, SkillsListResult } from "../shared/skills";

interface SkillsSettingsPanelProps {
  snapshot?: SkillsListResult | undefined;
  loading?: boolean | undefined;
  onRefresh: () => void;
}

export function SkillsSettingsPanel({ snapshot, loading, onRefresh }: SkillsSettingsPanelProps) {
  const userSkills = snapshot?.userSkills ?? [];

  return (
    <>
      <header className="settings-page-header">
        <div className="settings-page-header-row">
          <div>
            <h1>用户 Skills</h1>
            <p className="settings-page-desc">
              扫描 <code>~/.claude/skills/</code> 下的 Skill 目录（需含 <code>SKILL.md</code>）。
              打开项目后会自动预加载该项目 <code>.claude/skills/</code> 中的全部 Skills；在输入框输入{" "}
              <code>/</code> 可搜索并引用用户级 Skill（插入 <code>$skill-name</code>）。
            </p>
          </div>
          <button
            type="button"
            className="settings-icon-button"
            onClick={onRefresh}
            disabled={loading}
            aria-label="刷新 Skills 列表"
          >
            <RefreshCw size={18} className={loading ? "spinning" : undefined} />
          </button>
        </div>
      </header>

      <section className="settings-section">
        <div className="settings-section-head">
          <div>
            <span className="settings-section-label">已安装</span>
            <p className="settings-section-subtitle">~/.claude/skills/</p>
          </div>
          <span className="settings-count-badge">{userSkills.length}</span>
        </div>
        {userSkills.length === 0 ? (
          <p className="settings-empty-hint">
            在 <code>~/.claude/skills/&lt;skill-name&gt;/SKILL.md</code> 添加 Skill。
          </p>
        ) : (
          <ul className="skill-list">
            {userSkills.map((skill) => (
              <li key={skill.skillFilePath} className="skill-card">
                <div className="skill-card-icon" aria-hidden>
                  <Sparkles size={16} />
                </div>
                <div className="skill-card-body">
                  <div className="skill-card-title-row">
                    <strong>{skill.name}</strong>
                    <span className="skill-source-badge user">用户</span>
                  </div>
                  <p className="skill-card-description">{skill.description}</p>
                  <code className="skill-card-path">{skill.skillFilePath}</code>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
