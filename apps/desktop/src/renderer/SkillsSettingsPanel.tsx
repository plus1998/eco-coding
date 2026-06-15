import { RefreshCw, Sparkles } from "lucide-react";
import { dedupeSkillsByName, type LinkAgentsSkillsResult, type SkillsListResult } from "../shared/skills";

interface SkillsSettingsPanelProps {
  snapshot?: SkillsListResult | undefined;
  loading?: boolean | undefined;
  linking?: boolean | undefined;
  lastLinkResult?: LinkAgentsSkillsResult | undefined;
  onRefresh: () => void;
  onLinkAgents?: (() => void | Promise<void>) | undefined;
}

export function SkillsSettingsPanel({
  snapshot,
  loading,
  linking,
  lastLinkResult,
  onRefresh,
  onLinkAgents,
}: SkillsSettingsPanelProps) {
  const userSkills = dedupeSkillsByName(
    (snapshot?.userSkills ?? []).filter((skill) => skill.sdkReady),
  );
  const userAgentsOnly = dedupeSkillsByName(
    (snapshot?.agentsOnlySkills ?? []).filter((skill) => skill.source === "user"),
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

      {userAgentsOnly.length > 0 ? (
        <div className="settings-skills-link-block" role="note">
          <p className="composer-skills-pending-names">
            {userAgentsOnly.map((skill) => (
              <span key={skill.skillFilePath} className="composer-skill-pill is-pending" title={skill.description}>
                {skill.name}
              </span>
            ))}
          </p>
          <p className="composer-skills-link-hint settings-skills-link-hint">
            <span className="composer-skills-link-hint-message">
              {userAgentsOnly.length} 个 Skills 需链至 .claude
            </span>
            {onLinkAgents ? (
              <button
                type="button"
                className="composer-skills-link-action"
                disabled={linking}
                onClick={() => void onLinkAgents()}
              >
                {linking ? "链接中…" : "创建链接"}
              </button>
            ) : null}
            {lastLinkResult && lastLinkResult.created.length > 0 ? (
              <span className="composer-skills-link-hint-meta">已链接 {lastLinkResult.created.length} 个</span>
            ) : null}
          </p>
        </div>
      ) : null}

      <section className="settings-section">
        <div className="settings-section-head">
          <div>
            <span className="settings-section-label">已安装（SDK 可加载）</span>
            <p className="settings-section-subtitle">
              ~/.claude/skills/ · ~/.agents/skills/（已链接）
            </p>
          </div>
          <span className="settings-count-badge">{userSkills.length}</span>
        </div>
        {userSkills.length === 0 ? (
          <p className="settings-empty-hint">
            在 <code>~/.claude/skills/&lt;skill-name&gt;/SKILL.md</code> 或{" "}
            <code>~/.agents/skills/</code>（并链接到 .claude）添加 Skill。
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
