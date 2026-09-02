import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation();
  const projectSkillsNeedingLink = skillsNeedingLink.filter((skill) => skill.source === "project");
  if (availableSkills.length === 0 && projectSkillsNeedingLink.length === 0) {
    return null;
  }

  return (
    <section className="composer-skills-bar" aria-label={t("composer.skills.project")}>
      <div className="composer-skills-bar-row">
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
          <p className="composer-skills-link-hint">
            <span className="composer-skills-link-hint-message">
              {t("composer.skills.needLink", { count: projectSkillsNeedingLink.length })}
            </span>
            {onLinkAgents ? (
              <button
                type="button"
                className="composer-skills-link-action"
                disabled={linking}
                onClick={() => void onLinkAgents()}
              >
                {linking ? t("composer.skills.linking") : t("composer.skills.createLink")}
              </button>
            ) : null}
            {lastLinkResult && lastLinkResult.created.length > 0 ? (
              <span className="composer-skills-link-hint-meta">
                {t("composer.skills.linked", { count: lastLinkResult.created.length })}
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
