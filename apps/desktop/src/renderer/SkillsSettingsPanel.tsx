import { RefreshCw, Sparkles } from "lucide-react";
import type { SkillInfo, SkillsListResult } from "../shared/skills";

interface SkillsSettingsPanelProps {
  snapshot?: SkillsListResult | undefined;
  loading?: boolean | undefined;
  workspaceLabel?: string | undefined;
  onRefresh: () => void;
}

export function SkillsSettingsPanel({
  snapshot,
  loading,
  workspaceLabel,
  onRefresh,
}: SkillsSettingsPanelProps) {
  const userSkills = snapshot?.userSkills ?? [];
  const projectSkills = snapshot?.projectSkills ?? [];

  return (
    <>
      <header className="settings-page-header">
        <div className="settings-page-header-row">
          <div>
            <h1>Agent Skills</h1>
            <p className="settings-page-desc">
              展示 Eco 可扫描的 Skills。运行时不再使用 <code>skills: all</code>，而是固定启用{" "}
              <code>pdf</code>、<code>docx</code>，并在 Agent 定义中显式分配。将 Skill 目录放在{" "}
              <code>~/.claude/skills/</code>（用户）或仓库 <code>.claude/skills</code>（项目）下，每个目录需包含{" "}
              <code>SKILL.md</code>（含 <code>name</code>、<code>description</code> frontmatter）。
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
        {workspaceLabel && (
          <p className="settings-page-meta">
            当前扫描项目：<code>{workspaceLabel}</code>
          </p>
        )}
        {!workspaceLabel && (
          <p className="settings-page-meta">未打开项目时仅显示用户级 Skills。</p>
        )}
      </header>

      <SkillGroup
        title="用户 Skills"
        subtitle="~/.claude/skills/"
        skills={userSkills}
        emptyHint="在 ~/.claude/skills/&lt;skill-name&gt;/SKILL.md 添加 Skill。"
      />

      <SkillGroup
        title="项目 Skills"
        subtitle=".claude/skills/（自项目目录向上至 Git 根）"
        skills={projectSkills}
        emptyHint={
          workspaceLabel
            ? "在当前项目 .claude/skills/ 下添加 Skill 目录。"
            : "请先在主界面打开一个项目以扫描项目 Skills。"
        }
      />
    </>
  );
}

function SkillGroup({
  title,
  subtitle,
  skills,
  emptyHint,
}: {
  title: string;
  subtitle: string;
  skills: SkillInfo[];
  emptyHint: string;
}) {
  return (
    <section className="settings-section">
      <div className="settings-section-head">
        <div>
          <span className="settings-section-label">{title}</span>
          <p className="settings-section-subtitle">{subtitle}</p>
        </div>
        <span className="settings-count-badge">{skills.length}</span>
      </div>
      {skills.length === 0 ? (
        <p className="settings-empty-hint">{emptyHint}</p>
      ) : (
        <ul className="skill-list">
          {skills.map((skill) => (
            <li key={skill.skillFilePath} className="skill-card">
              <div className="skill-card-icon" aria-hidden>
                <Sparkles size={16} />
              </div>
              <div className="skill-card-body">
                <div className="skill-card-title-row">
                  <strong>{skill.name}</strong>
                  <span className={`skill-source-badge ${skill.source}`}>
                    {skill.source === "user" ? "用户" : "项目"}
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
  );
}
