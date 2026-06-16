import { Box } from "lucide-react";
import {
  type CSSProperties,
  type ReactNode,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import type { SkillInfo, SkillSource } from "../shared/skills";
import { formatSkillDisplayName } from "./composer-skills";

const PANEL_GAP = 8;
const VIEWPORT_MARGIN = 8;
/** Approximate row height (padding + title + desc + gap). */
const SKILL_MENU_ROW_HEIGHT = 54;
const SKILL_MENU_VISIBLE_ROWS = 5;
const SKILL_MENU_PADDING = 12;
const SKILL_MENU_PREFERRED_MAX_HEIGHT =
  SKILL_MENU_VISIBLE_ROWS * SKILL_MENU_ROW_HEIGHT + SKILL_MENU_PADDING;

export function skillScopeLabel(source: SkillSource): string {
  return source === "project" ? "项目" : "个人";
}

export function layoutSkillPanel(
  anchor: HTMLElement,
  maxWidth = 300,
): { style: CSSProperties; placement: "above" | "below" } {
  const rect = anchor.getBoundingClientRect();
  const width = Math.min(maxWidth, window.innerWidth - VIEWPORT_MARGIN * 2);
  let left = Math.max(VIEWPORT_MARGIN, rect.left);
  if (left + width > window.innerWidth - VIEWPORT_MARGIN) {
    left = window.innerWidth - VIEWPORT_MARGIN - width;
  }
  if (rect.top >= 80) {
    return {
      placement: "above",
      style: {
        position: "fixed",
        left,
        bottom: window.innerHeight - rect.top + PANEL_GAP,
        maxWidth: width,
        zIndex: 10001,
      },
    };
  }
  return {
    placement: "below",
    style: {
      position: "fixed",
      left,
      top: rect.bottom + PANEL_GAP,
      maxWidth: width,
      zIndex: 10001,
    },
  };
}

export function layoutSlashMenu(anchor: HTMLElement): CSSProperties {
  const rect = anchor.getBoundingClientRect();
  const width = Math.min(420, window.innerWidth - VIEWPORT_MARGIN * 2);
  let left = rect.left;
  const maxLeft = window.innerWidth - VIEWPORT_MARGIN - width;
  left = Math.max(VIEWPORT_MARGIN, Math.min(left, maxLeft));
  const spaceAbove = rect.top - VIEWPORT_MARGIN;
  const spaceMaxHeight = Math.max(80, spaceAbove - PANEL_GAP);
  const maxHeight = Math.min(spaceMaxHeight, SKILL_MENU_PREFERRED_MAX_HEIGHT);
  return {
    position: "fixed",
    left,
    bottom: window.innerHeight - rect.top + PANEL_GAP,
    width,
    maxHeight,
    zIndex: 10000,
  };
}

export function SkillIcon({ size = 15 }: { size?: number }) {
  return (
    <span className="composer-skill-icon" aria-hidden>
      <Box size={size} strokeWidth={1.75} />
    </span>
  );
}

export function SkillScopeBadge({ source }: { source: SkillSource }) {
  return <span className="composer-skill-badge">{skillScopeLabel(source)}</span>;
}

export function SkillCardContent({ skill }: { skill: SkillInfo }) {
  return (
    <div className="composer-skill-card-body">
      <SkillIcon />
      <div className="composer-skill-card-text">
        <div className="composer-skill-card-title-row">
          <p className="composer-skill-card-title">{formatSkillDisplayName(skill.name, skill)}</p>
          <SkillScopeBadge source={skill.source} />
        </div>
        <p className="composer-skill-card-desc">{skill.description}</p>
      </div>
    </div>
  );
}

export function SkillFloatingCard({
  open,
  skill,
  anchorRef,
  panelRef,
  onPointerInsideChange,
}: {
  open: boolean;
  skill: SkillInfo;
  anchorRef: RefObject<HTMLElement | null>;
  panelRef?: RefObject<HTMLDivElement | null>;
  onPointerInsideChange?: (inside: boolean) => void;
}) {
  const localPanelRef = useRef<HTMLDivElement>(null);
  const resolvedPanelRef = panelRef ?? localPanelRef;
  const [layout, setLayout] = useState<{ style: CSSProperties; placement: "above" | "below" } | null>(
    null,
  );

  useLayoutEffect(() => {
    if (!open || !anchorRef.current) {
      setLayout(null);
      return;
    }
    setLayout(layoutSkillPanel(anchorRef.current));
  }, [open, anchorRef, skill.skillFilePath]);

  if (!open || !layout) {
    return null;
  }

  return createPortal(
    <div
      ref={resolvedPanelRef}
      className="composer-skill-card is-floating"
      style={layout.style}
      data-placement={layout.placement}
      role="tooltip"
      onMouseEnter={() => onPointerInsideChange?.(true)}
      onMouseLeave={() => onPointerInsideChange?.(false)}
    >
      <SkillCardContent skill={skill} />
    </div>,
    document.body,
  );
}

export function SkillPillWithCard({
  skill,
  variant = "default",
}: {
  skill: SkillInfo;
  variant?: "default" | "pending" | "referenced";
}) {
  const anchorRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState(false);
  const [pointerInCard, setPointerInCard] = useState(false);
  const [pinned, setPinned] = useState(false);
  const leaveTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const showCard = hovered || pointerInCard || pinned;
  const pinOnClick = variant !== "pending";

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
      if (anchorRef.current?.contains(target) || panelRef.current?.contains(target)) {
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

  return (
    <li className="composer-skill-pill-item">
      <button
        ref={anchorRef}
        type="button"
        className={[
          "composer-skill-pill",
          variant === "pending" ? "is-pending" : "",
          variant === "referenced" ? "is-referenced" : "",
          showCard ? "is-active" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        aria-expanded={showCard}
        onMouseEnter={() => {
          clearLeaveTimer();
          setHovered(true);
        }}
        onMouseLeave={scheduleHoverEnd}
        onFocus={() => setHovered(true)}
        onBlur={scheduleHoverEnd}
        onClick={pinOnClick ? () => setPinned((current) => !current) : undefined}
      >
        {formatSkillDisplayName(skill.name, skill)}
      </button>
      <SkillFloatingCard
        open={showCard}
        skill={skill}
        anchorRef={anchorRef}
        panelRef={panelRef}
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

export function SkillMenuRow({
  title,
  description,
  source,
  active,
  onHover,
  onSelect,
}: {
  title: ReactNode;
  description: string;
  source: SkillSource;
  active: boolean;
  onHover: () => void;
  onSelect: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        role="option"
        aria-selected={active}
        className={active ? "composer-skill-menu-item is-active" : "composer-skill-menu-item"}
        onMouseEnter={onHover}
        onClick={onSelect}
      >
        <span className="composer-skill-menu-icon" aria-hidden>
          <Box size={16} />
        </span>
        <span className="composer-skill-menu-text">
          <span className="composer-skill-menu-title">{title}</span>
          <span className="composer-skill-menu-desc">{description}</span>
        </span>
        <SkillScopeBadge source={source} />
      </button>
    </li>
  );
}
