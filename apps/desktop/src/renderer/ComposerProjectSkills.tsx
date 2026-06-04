import type { LinkAgentsSkillsResult, SkillInfo } from "../shared/skills";

interface ComposerProjectSkillsProps {
  sdkReadySkills: readonly SkillInfo[];
  agentsOnlySkills: readonly SkillInfo[];
  linking?: boolean | undefined;
  onSelectSkill?: (skill: SkillInfo) => void;
  onLinkAgents?: () => void | Promise<void>;
  lastLinkResult?: LinkAgentsSkillsResult | undefined;
}

export function ComposerProjectSkills({
  sdkReadySkills,
  agentsOnlySkills,
  linking,
  onSelectSkill,
  onLinkAgents,
  lastLinkResult,
}: ComposerProjectSkillsProps) {
  const projectAgentsOnly = agentsOnlySkills.filter((skill) => skill.source === "project");
  if (sdkReadySkills.length === 0 && projectAgentsOnly.length === 0) {
    return null;
  }

  const showSkillsRow = sdkReadySkills.length > 0 || projectAgentsOnly.length > 0;

  return (
    <section className="composer-project-skills" aria-label="当前项目 Skills">
      {showSkillsRow ? (
        <div className="composer-project-skills-row">
          <span className="composer-project-skills-label">Skills</span>
          <ul className="composer-project-skills-tags">
            {sdkReadySkills.map((skill) => (
              <li key={skill.skillFilePath}>
                {onSelectSkill ? (
                  <button
                    type="button"
                    className="composer-project-skill-tag"
                    title={skill.description}
                    onClick={() => onSelectSkill(skill)}
                  >
                    {skill.name}
                  </button>
                ) : (
                  <span className="composer-project-skill-tag is-static" title={skill.description}>
                    {skill.name}
                  </span>
                )}
              </li>
            ))}
            {projectAgentsOnly.map((skill) => (
              <li key={skill.skillFilePath}>
                <span className="composer-project-skill-tag is-pending" title={skill.description}>
                  {skill.name}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {projectAgentsOnly.length > 0 ? (
        <div className="composer-project-skills-row composer-skills-link-hint-row" role="note">
          <span className="composer-project-skills-label" aria-hidden="true" />
          <p className="composer-skills-link-hint">
            <span className="composer-skills-link-hint-message">需链至 .claude 后 Agent 可加载</span>
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
              <span className="composer-skills-link-hint-meta" title={`已链接 ${lastLinkResult.created.length} 个`}>
                已链接 {lastLinkResult.created.length} 个
              </span>
            ) : null}
            {lastLinkResult && lastLinkResult.errors.length > 0 ? (
              <span className="composer-skills-link-hint-error" title={lastLinkResult.errors[0]}>
                {lastLinkResult.errors[0]}
              </span>
            ) : null}
          </p>
        </div>
      ) : null}
    </section>
  );
}
