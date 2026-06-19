import { RefreshCw, Sparkles } from "lucide-react";
import { dedupeSkillsByName, type SkillsListResult } from "../shared/skills";

interface SkillsSettingsPanelProps {
  snapshot?: SkillsListResult | undefined;
  loading?: boolean | undefined;
  onRefresh: () => void;
}

export function SkillsSettingsPanel({
  snapshot,
  loading,
  onRefresh,
}: SkillsSettingsPanelProps) {
  const userSkills = dedupeSkillsByName(
    (snapshot?.userSkills ?? []).filter((skill) => skill.sdkReady),
  );

  return (
    <>
      <header className="settings-page-header">
        <div className="settings-page-header-row">
          <div>
            <h1>Skills</h1>
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
        {userSkills.length === 0 ? (
          <p className="settings-empty-hint">
            在 <code>~/.claude/skills/&lt;skill-name&gt;/SKILL.md</code> 或{" "}
            <code>~/.agents/skills/</code> 添加 Skill。
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
                    <span className={`skill-source-badge ${skill.layout}`}>
                      {skill.layout === "claude" ? "Claude" : "Agents"}
                    </span>
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
