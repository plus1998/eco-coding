import {
  type CSSProperties,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Box } from "lucide-react";
import { createPortal } from "react-dom";
import type { LinkAgentsSkillsResult, SkillInfo } from "../shared/skills";
import { formatSkillChipLabel } from "./composer-skill-prompt";

interface ComposerProjectSkillsProps {
  sdkReadySkills: readonly SkillInfo[];
  agentsOnlySkills: readonly SkillInfo[];
  referencedSkillNames?: ReadonlySet<string> | undefined;
  linking?: boolean | undefined;
  onLinkAgents?: () => void | Promise<void>;
  lastLinkResult?: LinkAgentsSkillsResult | undefined;
}

function skillDetailCardLayout(anchor: HTMLElement): {
  style: CSSProperties;
  placement: "above" | "below";
} {
  const rect = anchor.getBoundingClientRect();
  const maxWidth = Math.min(300, window.innerWidth - 16);
  let left = Math.max(8, rect.left);
  if (left + maxWidth > window.innerWidth - 8) {
    left = window.innerWidth - 8 - maxWidth;
  }
  const placeAbove = rect.top >= 80;
  if (placeAbove) {
    return {
      placement: "above",
      style: {
        position: "fixed",
        left,
        bottom: window.innerHeight - rect.top + 8,
        maxWidth,
        zIndex: 10001,
      },
    };
  }
  return {
    placement: "below",
    style: {
      position: "fixed",
      left,
      top: rect.bottom + 8,
      maxWidth,
      zIndex: 10001,
    },
  };
}

function SkillDetailCardPortal({
  open,
  skill,
  anchorRef,
  onPointerInsideChange,
}: {
  open: boolean;
  skill: SkillInfo;
  anchorRef: RefObject<HTMLButtonElement | null>;
  onPointerInsideChange?: (inside: boolean) => void;
}) {
  const [style, setStyle] = useState<CSSProperties>({ visibility: "hidden" });
  const [placement, setPlacement] = useState<"above" | "below">("above");

  useLayoutEffect(() => {
    if (!open) {
      return;
    }
    const anchor = anchorRef.current;
    if (!anchor) {
      return;
    }
    const layout = skillDetailCardLayout(anchor);
    setPlacement(layout.placement);
    setStyle({ ...layout.style, visibility: "visible" });
  }, [open, anchorRef, skill.skillFilePath]);

  if (!open) {
    return null;
  }

  const scopeLabel = skill.source === "project" ? "项目" : "个人";

  return createPortal(
    <div
      className="composer-skill-detail-card is-portal"
      style={style}
      data-placement={placement}
      role="tooltip"
      onMouseEnter={() => onPointerInsideChange?.(true)}
      onMouseLeave={() => onPointerInsideChange?.(false)}
    >
      <div className="composer-skill-detail-card-head">
        <span className="composer-skill-detail-card-icon" aria-hidden>
          <Box size={15} strokeWidth={1.75} />
        </span>
        <div className="composer-skill-detail-card-meta">
          <div className="composer-skill-detail-card-title-row">
            <p className="composer-skill-detail-card-title">{formatSkillChipLabel(skill.name, skill)}</p>
            <span className="composer-skill-detail-card-badge">{scopeLabel}</span>
          </div>
          <p className="composer-skill-detail-card-desc">{skill.description}</p>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function ProjectSkillTag({
  skill,
  referenced,
  pending = false,
}: {
  skill: SkillInfo;
  referenced?: boolean;
  pending?: boolean;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [hovered, setHovered] = useState(false);
  const [pointerInCard, setPointerInCard] = useState(false);
  const [pinned, setPinned] = useState(false);
  const leaveTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const showCard = pinned || hovered || pointerInCard;

  const clearLeaveTimer = () => {
    if (leaveTimerRef.current !== undefined) {
      clearTimeout(leaveTimerRef.current);
      leaveTimerRef.current = undefined;
    }
  };

  const scheduleHoverEnd = () => {
    clearLeaveTimer();
    leaveTimerRef.current = setTimeout(() => {
      if (!pinned) {
        setHovered(false);
      }
    }, 120);
  };

  useEffect(() => {
    if (!pinned) {
      return;
    }
    function onPointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (buttonRef.current?.contains(target)) {
        return;
      }
      const portalCard = document.querySelector(".composer-skill-detail-card.is-portal");
      if (portalCard?.contains(target)) {
        return;
      }
      setPinned(false);
      setHovered(false);
      setPointerInCard(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [pinned]);

  useEffect(() => () => clearLeaveTimer(), []);

  const tagClassName = [
    "composer-project-skill-tag",
    pending ? "is-pending" : "",
    !pending && referenced ? "is-referenced" : "",
    showCard ? "is-active" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <li className="composer-project-skill-item">
      <button
        ref={buttonRef}
        type="button"
        className={tagClassName}
        aria-expanded={showCard}
        onMouseEnter={() => {
          clearLeaveTimer();
          setHovered(true);
        }}
        onMouseLeave={scheduleHoverEnd}
        onFocus={() => setHovered(true)}
        onBlur={scheduleHoverEnd}
        onClick={
          pending
            ? undefined
            : () => {
                setPinned((current) => !current);
              }
        }
      >
        {skill.name}
      </button>
      <SkillDetailCardPortal
        open={showCard}
        skill={skill}
        anchorRef={buttonRef}
        onPointerInsideChange={(inside) => {
          setPointerInCard(inside);
          if (inside) {
            clearLeaveTimer();
            setHovered(true);
          } else {
            scheduleHoverEnd();
          }
        }}
      />
    </li>
  );
}

export function ComposerProjectSkills({
  sdkReadySkills,
  agentsOnlySkills,
  referencedSkillNames,
  linking,
  onLinkAgents,
  lastLinkResult,
}: ComposerProjectSkillsProps) {
  const projectAgentsOnly = agentsOnlySkills.filter((skill) => skill.source === "project");
  if (sdkReadySkills.length === 0 && projectAgentsOnly.length === 0) {
    return null;
  }

  const referenced = referencedSkillNames ?? new Set<string>();

  return (
    <section className="composer-project-skills" aria-label="当前项目 Skills">
      <div className="composer-project-skills-row">
        <span className="composer-project-skills-label">Skills</span>
        <ul className="composer-project-skills-tags">
          {sdkReadySkills.map((skill) => (
            <ProjectSkillTag
              key={skill.skillFilePath}
              skill={skill}
              referenced={referenced.has(skill.name)}
            />
          ))}
          {projectAgentsOnly.map((skill) => (
            <ProjectSkillTag key={skill.skillFilePath} skill={skill} pending />
          ))}
        </ul>
      </div>

      {projectAgentsOnly.length > 0 ? (
        <div className="composer-project-skills-row composer-skills-link-hint-row" role="note">
          <span className="composer-project-skills-label" aria-hidden="true" />
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
