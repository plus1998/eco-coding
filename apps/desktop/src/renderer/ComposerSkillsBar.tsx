import type { LinkAgentsSkillsResult, SkillInfo } from "../shared/skills";
import { SkillPillWithCard } from "./composer-skills-ui";

interface ComposerSkillsBarProps {
  sdkReadySkills: readonly SkillInfo[];
  agentsOnlySkills: readonly SkillInfo[];
  referencedSkillNames: ReadonlySet<string>;
  linking?: boolean | undefined;
  onLinkAgents?: () => void | Promise<void>;
  lastLinkResult?: LinkAgentsSkillsResult | undefined;
}

export function ComposerSkillsBar({
  sdkReadySkills,
  agentsOnlySkills,
  referencedSkillNames,
  linking,
  onLinkAgents,
  lastLinkResult,
}: ComposerSkillsBarProps) {
  const projectAgentsOnly = agentsOnlySkills.filter((skill) => skill.source === "project");
  if (sdkReadySkills.length === 0 && projectAgentsOnly.length === 0) {
    return null;
  }

  return (
    <section className="composer-skills-bar" aria-label="当前项目 Skills">
      <div className="composer-skills-bar-row">
        <span className="composer-skills-bar-label">Skills</span>
        <ul className="composer-skills-bar-list">
          {sdkReadySkills.map((skill) => (
            <SkillPillWithCard
              key={skill.skillFilePath}
              skill={skill}
              variant={referencedSkillNames.has(skill.name) ? "referenced" : "default"}
            />
          ))}
          {projectAgentsOnly.map((skill) => (
            <SkillPillWithCard key={skill.skillFilePath} skill={skill} variant="pending" />
          ))}
        </ul>
      </div>

      {projectAgentsOnly.length > 0 ? (
        <div className="composer-skills-bar-row composer-skills-link-hint-row" role="note">
          <span className="composer-skills-bar-label" aria-hidden="true" />
          <p className="composer-skills-link-hint">
            <span className="composer-skills-link-hint-message">
              {projectAgentsOnly.length} 个 Skills 需链至 .claude
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
