import { Box } from "lucide-react";
import { type CSSProperties, type RefObject, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { SkillInfo } from "../shared/skills";
import { filterUserSkills, highlightSkillName, type SkillFuzzyMatch } from "./skill-fuzzy";

const POPOVER_WIDTH = 420;
const VIEWPORT_MARGIN = 8;
const ANCHOR_GAP = 8;
const MIN_POPOVER_HEIGHT = 80;

function clampPopoverLeft(anchorLeft: number, width: number): number {
  const maxLeft = window.innerWidth - VIEWPORT_MARGIN - width;
  return Math.max(VIEWPORT_MARGIN, Math.min(anchorLeft, maxLeft));
}

function popoverStyleForAnchor(anchor: HTMLElement): CSSProperties {
  const rect = anchor.getBoundingClientRect();
  const width = Math.min(POPOVER_WIDTH, window.innerWidth - VIEWPORT_MARGIN * 2);
  const spaceAbove = rect.top - VIEWPORT_MARGIN;
  const maxHeight = Math.max(MIN_POPOVER_HEIGHT, spaceAbove - ANCHOR_GAP);
  return {
    position: "fixed",
    left: clampPopoverLeft(rect.left, width),
    bottom: window.innerHeight - rect.top + ANCHOR_GAP,
    width,
    maxHeight,
    zIndex: 10000,
  };
}

interface ComposerSkillPopoverProps {
  open: boolean;
  query: string;
  userSkills: readonly SkillInfo[];
  activeIndex: number;
  anchorRef: RefObject<HTMLElement | null>;
  onActiveIndexChange: (index: number) => void;
  onSelect: (skill: SkillInfo) => void;
  onClose: () => void;
}

export function ComposerSkillPopover({
  open,
  query,
  userSkills,
  activeIndex,
  anchorRef,
  onActiveIndexChange,
  onSelect,
  onClose,
}: ComposerSkillPopoverProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [panelStyle, setPanelStyle] = useState<CSSProperties>(() => ({ visibility: "hidden" }));

  const matches = filterUserSkills(query, userSkills);

  const updatePanelPosition = useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor) {
      return;
    }
    setPanelStyle(popoverStyleForAnchor(anchor));
  }, [anchorRef]);

  useLayoutEffect(() => {
    if (!open) {
      return;
    }
    updatePanelPosition();
    window.addEventListener("resize", updatePanelPosition);
    window.addEventListener("scroll", updatePanelPosition, true);
    return () => {
      window.removeEventListener("resize", updatePanelPosition);
      window.removeEventListener("scroll", updatePanelPosition, true);
    };
  }, [open, updatePanelPosition, matches.length]);

  useEffect(() => {
    if (!open) {
      return;
    }
    function onPointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || anchorRef.current?.contains(target)) {
        return;
      }
      onClose();
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose, anchorRef]);

  useEffect(() => {
    if (!open || matches.length === 0) {
      return;
    }
    const row = listRef.current?.children[activeIndex] as HTMLElement | undefined;
    row?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex, matches.length]);

  if (!open) {
    return null;
  }

  return createPortal(
    <div
      ref={panelRef}
      className="composer-skill-popover"
      role="listbox"
      aria-label="选择用户 Skill"
      style={panelStyle}
    >
      {matches.length === 0 ? (
        <p className="composer-skill-popover-empty">没有匹配的用户 Skill</p>
      ) : (
        <ul ref={listRef} className="composer-skill-popover-list">
          {matches.map((match, index) => (
            <SkillRow
              key={match.skill.skillFilePath}
              match={match}
              active={index === activeIndex}
              onHover={() => onActiveIndexChange(index)}
              onSelect={() => onSelect(match.skill)}
            />
          ))}
        </ul>
      )}
    </div>,
    document.body,
  );
}

function SkillRow({
  match,
  active,
  onHover,
  onSelect,
}: {
  match: SkillFuzzyMatch;
  active: boolean;
  onHover: () => void;
  onSelect: () => void;
}) {
  const titleParts = highlightSkillName(match.skill.name, match.ranges);

  return (
    <li>
      <button
        type="button"
        role="option"
        aria-selected={active}
        className={active ? "composer-skill-row is-active" : "composer-skill-row"}
        onMouseEnter={onHover}
        onClick={onSelect}
      >
        <span className="composer-skill-row-icon" aria-hidden>
          <Box size={16} />
        </span>
        <span className="composer-skill-row-body">
          <span className="composer-skill-row-title">
            {titleParts.map((part, index) =>
              part.match ? (
                <strong key={index} className="composer-skill-title-match">
                  {part.text}
                </strong>
              ) : (
                <span key={index}>{part.text}</span>
              ),
            )}
          </span>
          <span className="composer-skill-row-description">{match.skill.description}</span>
        </span>
        <span className="composer-skill-scope">个人</span>
      </button>
    </li>
  );
}
