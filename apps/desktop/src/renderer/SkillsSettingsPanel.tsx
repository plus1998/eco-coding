import { RefreshCw, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { AGENT_ROLES, type AgentRole, type AgentSkillAssignments } from "../shared/ipc";
import type { SkillInfo, SkillsListResult } from "../shared/skills";

interface SkillsSettingsPanelProps {
  snapshot?: SkillsListResult | undefined;
  assignments: AgentSkillAssignments;
  loading?: boolean | undefined;
  saving?: boolean | undefined;
  workspaceLabel?: string | undefined;
  onRefresh: () => void;
  onSaveAssignments: (assignments: AgentSkillAssignments) => void | Promise<void>;
}

const ROLE_LABELS: Record<AgentRole, string> = {
  planner: "规划 (Planner)",
  explore: "探索 (Explore)",
  architect: "架构 (Architect)",
  coder: "编码 (Coder)",
  reviewer: "审查 (Reviewer)",
  tester: "测试 (Tester)",
};

export function SkillsSettingsPanel({
  snapshot,
  assignments,
  loading,
  saving,
  workspaceLabel,
  onRefresh,
  onSaveAssignments,
}: SkillsSettingsPanelProps) {
  const userSkills = snapshot?.userSkills ?? [];
  const projectSkills = snapshot?.projectSkills ?? [];
  const [draft, setDraft] = useState<AgentSkillAssignments>(() => cloneAssignments(assignments));

  useEffect(() => {
    setDraft(cloneAssignments(assignments));
  }, [assignments]);

  const catalog = useMemo(() => buildSkillCatalog(userSkills, projectSkills), [userSkills, projectSkills]);
  const catalogNames = useMemo(() => catalog.map((skill) => skill.name), [catalog]);
  const dirty = useMemo(() => !assignmentsEqual(draft, assignments), [draft, assignments]);

  function toggleSkill(role: AgentRole, skillName: string) {
    setDraft((current) => {
      const next = cloneAssignments(current);
      const selected = new Set(next[role]);
      if (selected.has(skillName)) {
        selected.delete(skillName);
      } else {
        selected.add(skillName);
      }
      next[role] = [...selected].sort((a, b) => a.localeCompare(b));
      return next;
    });
  }

  return (
    <>
      <header className="settings-page-header">
        <div className="settings-page-header-row">
          <div>
            <h1>Agent Skills</h1>
            <p className="settings-page-desc">
              扫描 <code>~/.claude/skills/</code> 与项目 <code>.claude/skills/</code> 下的 Skill 目录（需含{" "}
              <code>SKILL.md</code>）。在下方为每个 Agent 勾选运行时预加载的 Skill；配置保存在本地 SQLite，不同
              Agent 可使用不同组合。
            </p>
          </div>
          <button
            type="button"
            className="settings-icon-button"
            onClick={onRefresh}
            disabled={loading || saving}
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

      <section className="settings-section">
        <div className="settings-section-head">
          <div>
            <span className="settings-section-label">按 Agent 分配</span>
            <p className="settings-section-subtitle">
              主会话 Planner 使用「规划」列；子代理使用各自列。未勾选则不预加载 Skill。
            </p>
          </div>
          <button
            type="button"
            className="plan-button primary"
            disabled={!dirty || saving || catalog.length === 0}
            onClick={() => void onSaveAssignments(draft)}
          >
            {saving ? "保存中…" : "保存分配"}
          </button>
        </div>

        {catalog.length === 0 ? (
          <p className="settings-empty-hint">请先添加可扫描的 Skill 目录，再为 Agent 分配。</p>
        ) : (
          <div className="agent-skills-matrix-wrap">
            <table className="agent-skills-matrix">
              <thead>
                <tr>
                  <th scope="col">Skill</th>
                  {AGENT_ROLES.map((role) => (
                    <th key={role} scope="col">
                      {ROLE_LABELS[role]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {catalog.map((skill) => (
                  <tr key={skill.name}>
                    <th scope="row" className="agent-skills-skill-cell">
                      <span className="agent-skills-skill-name">{skill.name}</span>
                      <span className={`skill-source-badge ${skill.source}`}>
                        {skill.source === "user" ? "用户" : "项目"}
                      </span>
                    </th>
                    {AGENT_ROLES.map((role) => {
                      const checked = draft[role].includes(skill.name);
                      return (
                        <td key={`${skill.name}-${role}`} className="agent-skills-check-cell">
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={saving}
                            aria-label={`${skill.name} · ${ROLE_LABELS[role]}`}
                            onChange={() => toggleSkill(role, skill.name)}
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {catalogNames.length > 0 && (
          <p className="settings-page-meta agent-skills-hint">
            已保存的配置若包含当前扫描不到的 Skill 名称，保存时会被自动移除。
          </p>
        )}
      </section>

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

function buildSkillCatalog(userSkills: SkillInfo[], projectSkills: SkillInfo[]): SkillInfo[] {
  const byName = new Map<string, SkillInfo>();
  for (const skill of [...userSkills, ...projectSkills]) {
    if (!byName.has(skill.name)) {
      byName.set(skill.name, skill);
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function cloneAssignments(assignments: AgentSkillAssignments): AgentSkillAssignments {
  return Object.fromEntries(AGENT_ROLES.map((role) => [role, [...assignments[role]]])) as AgentSkillAssignments;
}

function assignmentsEqual(a: AgentSkillAssignments, b: AgentSkillAssignments): boolean {
  return AGENT_ROLES.every((role) => {
    const left = [...a[role]].sort();
    const right = [...b[role]].sort();
    return left.length === right.length && left.every((value, index) => value === right[index]);
  });
}
