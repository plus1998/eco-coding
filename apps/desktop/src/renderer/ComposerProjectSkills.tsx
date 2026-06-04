import { Box } from "lucide-react";
import type { SkillInfo } from "../shared/skills";

interface ComposerProjectSkillsProps {
  skills: readonly SkillInfo[];
  loading?: boolean | undefined;
  onSelectSkill?: (skill: SkillInfo) => void;
}

export function ComposerProjectSkills({
  skills,
  loading,
  onSelectSkill,
}: ComposerProjectSkillsProps) {
  if (loading) {
    return (
      <section className="composer-project-skills" aria-label="当前项目 Skills">
        <p className="composer-project-skills-meta">正在扫描项目 Skills…</p>
      </section>
    );
  }

  if (skills.length === 0) {
    return (
      <section className="composer-project-skills" aria-label="当前项目 Skills">
        <p className="composer-project-skills-meta">
          当前项目暂无 Skills。可在 <code>.claude/skills/&lt;name&gt;/SKILL.md</code> 添加，打开对话后将自动加载。
        </p>
      </section>
    );
  }

  return (
    <section className="composer-project-skills" aria-label="当前项目 Skills">
      <p className="composer-project-skills-heading">
        项目 Skills
        <span className="composer-project-skills-count">{skills.length}</span>
      </p>
      <ul className="composer-project-skills-list">
        {skills.map((skill) => (
          <li key={skill.skillFilePath}>
            {onSelectSkill ? (
              <button
                type="button"
                className="composer-project-skill-chip"
                title={skill.description}
                onClick={() => onSelectSkill(skill)}
              >
                <SkillChipContent skill={skill} />
              </button>
            ) : (
              <div className="composer-project-skill-chip is-static">
                <SkillChipContent skill={skill} />
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function SkillChipContent({ skill }: { skill: SkillInfo }) {
  return (
    <>
      <span className="composer-project-skill-icon" aria-hidden>
        <Box size={14} />
      </span>
      <span className="composer-project-skill-body">
        <span className="composer-project-skill-name">{skill.name}</span>
        <span className="composer-project-skill-description">{skill.description}</span>
      </span>
      <span className="composer-project-skill-scope">项目</span>
    </>
  );
}
