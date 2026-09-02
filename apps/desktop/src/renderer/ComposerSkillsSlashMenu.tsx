import {
  type CSSProperties,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import type { SkillInfo } from "../shared/skills";
import { formatSkillDisplayName } from "./composer-skills";
import { layoutSlashMenu, SkillMenuRow } from "./composer-skills-ui";
import { highlightQueryInLabel, type SkillFuzzyMatch } from "./skill-fuzzy";

interface ComposerSkillsSlashMenuProps {
  open: boolean;
  query: string;
  skills: readonly SkillInfo[];
  matches: readonly SkillFuzzyMatch[];
  activeIndex: number;
  anchorRef: RefObject<HTMLElement | null>;
  onActiveIndexChange: (index: number) => void;
  onSelect: (skill: SkillInfo) => void;
  onClose: () => void;
}

export function ComposerSkillsSlashMenu({
  open,
  query,
  skills,
  matches,
  activeIndex,
  anchorRef,
  onActiveIndexChange,
  onSelect,
  onClose,
}: ComposerSkillsSlashMenuProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [panelStyle, setPanelStyle] = useState<CSSProperties>({ visibility: "hidden" });

  const updatePosition = useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor) {
      return;
    }
    setPanelStyle(layoutSlashMenu(anchor));
  }, [anchorRef]);

  useLayoutEffect(() => {
    if (!open) {
      return;
    }
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open, updatePosition, matches.length]);

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

  const emptyMessage =
    skills.length === 0 ? "没有可用的 Skill" : query.trim() ? "没有匹配的 Skill" : "输入 Skill 名称筛选";

  return createPortal(
    <div
      ref={panelRef}
      className="composer-skill-menu"
      role="listbox"
      aria-label="选择 Skill"
      style={panelStyle}
      onMouseDown={(event) => event.preventDefault()}
    >
      {matches.length === 0 ? (
        <p className="composer-skill-menu-empty">{emptyMessage}</p>
      ) : (
        <ul ref={listRef} className="composer-skill-menu-list">
          {matches.map((match, index) => {
            const displayName = formatSkillDisplayName(match.skill.name, match.skill);
            const titleParts = highlightQueryInLabel(query, displayName);
            return (
              <SkillMenuRow
                key={match.skill.skillFilePath}
                active={index === activeIndex}
                description={match.skill.description}
                source={match.skill.source}
                onHover={() => onActiveIndexChange(index)}
                onSelect={() => onSelect(match.skill)}
                title={
                  <>
                    {titleParts.map((part, partIndex) =>
                      part.match ? (
                        <strong key={partIndex} className="composer-skill-menu-match">
                          {part.text}
                        </strong>
                      ) : (
                        <span key={partIndex}>{part.text}</span>
                      ),
                    )}
                  </>
                }
              />
            );
          })}
        </ul>
      )}
    </div>,
    document.body,
  );
}
