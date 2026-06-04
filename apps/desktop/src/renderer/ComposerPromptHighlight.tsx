import { Box } from "lucide-react";
import type { SkillInfo } from "../shared/skills";
import { formatSkillChipLabel, parseComposerPromptSegments, skillTokenForName } from "./composer-skill-prompt";

interface ComposerPromptHighlightProps {
  text: string;
  skillsByName: ReadonlyMap<string, SkillInfo>;
}

export function ComposerPromptHighlight({ text, skillsByName }: ComposerPromptHighlightProps) {
  if (!text) {
    return null;
  }

  const segments = parseComposerPromptSegments(text);

  return (
    <>
      {segments.map((segment, index) => {
        if (segment.type === "text") {
          return (
            <span key={index} className="composer-prompt-plain">
              {segment.value}
            </span>
          );
        }
        const skill = skillsByName.get(segment.name);
        const token = skillTokenForName(segment.name);
        const label = formatSkillChipLabel(segment.name, skill);
        return (
          <span key={index} className="composer-skill-chip-inline" title={skill?.description}>
            <span className="composer-skill-chip-sizer">{token}</span>
            <span className="composer-skill-chip-overlay" aria-hidden>
              <Box size={14} className="composer-skill-chip-icon" />
              <span className="composer-skill-chip-label">{label}</span>
            </span>
          </span>
        );
      })}
    </>
  );
}
