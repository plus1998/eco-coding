import type { LinkAgentsSkillsResult, SkillInfo } from "../shared/skills";
import { SkillPillWithCard } from "./composer-skills-ui";

interface ComposerSkillsBarProps {
  availableSkills: readonly SkillInfo[];
  skillsNeedingLink: readonly SkillInfo[];
  referencedSkillNames: ReadonlySet<string>;
  linking?: boolean | undefined;
  onLinkAgents?: () => void | Promise<void>;
  lastLinkResult?: LinkAgentsSkillsResult | undefined;
}

export function ComposerSkillsBar({
  availableSkills,
  skillsNeedingLink,
  referencedSkillNames,
  linking,
  onLinkAgents,
  lastLinkResult,
}: ComposerSkillsBarProps) {
  const projectSkillsNeedingLink = skillsNeedingLink.filter((skill) => skill.source === "project");
  if (availableSkills.length === 0 && projectSkillsNeedingLink.length === 0) {
    return null;
  }

  return (
    <section className="composer-skills-bar" aria-label="当前项目 Skills">
      <div className="composer-skills-bar-row">
        <span className="composer-skills-bar-label">Skills</span>
        <ul className="composer-skills-bar-list">
          {availableSkills.map((skill) => (
            <SkillPillWithCard
              key={skill.skillFilePath}
              skill={skill}
              variant={referencedSkillNames.has(skill.name) ? "referenced" : "default"}
            />
          ))}
          {projectSkillsNeedingLink.map((skill) => (
            <SkillPillWithCard key={skill.skillFilePath} skill={skill} variant="pending" />
          ))}
        </ul>
      </div>

      {projectSkillsNeedingLink.length > 0 ? (
        <div className="composer-skills-bar-row composer-skills-link-hint-row" role="note">
          <span className="composer-skills-bar-label" aria-hidden="true" />
          <p className="composer-skills-link-hint">
            <span className="composer-skills-link-hint-message">
              {projectSkillsNeedingLink.length} 个 Skills 需链至 .claude
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
              <span className="composer-skills-link-hint-meta">
                已链接 {lastLinkResult.created.length} 个
              </span>
            ) : null}
            {lastLinkResult && lastLinkResult.errors.length > 0 ? (
              <span className="composer-skills-link-hint-error">{lastLinkResult.errors[0]}</span>
            ) : null}
          </p>
        </div>
      ) : null}
    </section>
  );
}
