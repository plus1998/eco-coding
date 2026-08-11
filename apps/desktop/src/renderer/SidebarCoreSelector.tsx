import type { CoreKind } from "@eco/runtime/core-runtime";
import { Check, ChevronDown, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { i18n } from "./i18n";
import { SidebarAttentionButton } from "./SidebarAttentionButton";
import type { SidebarAttentionItem } from "./sidebar-attention-items";

interface SidebarCoreSelectorProps {
  coreKind: CoreKind | undefined;
  locked: boolean;
  busy: boolean;
  codexAvailable: boolean;
  codexUnavailableReason?: string;
  piAvailable?: boolean;
  piUnavailableReason?: string;
  attentionItems: readonly SidebarAttentionItem[];
  onChange: (coreKind: CoreKind) => void;
  onOpenSearch: () => void;
  onSelectAttentionThread: (threadId: string) => void;
}

const coreOptions: Array<{ kind: CoreKind; label: string; iconSrc: string }> = [
  { kind: "codex", label: "Codex", iconSrc: "./agent-icons/codex.ico" },
  { kind: "claude", label: "Claude Code", iconSrc: "./agent-icons/claude-code.ico" },
  { kind: "pi", label: "π", iconSrc: "./agent-icons/pi.svg" },
];

export function coreDisplayName(coreKind: CoreKind | undefined): string {
  if (coreKind === "codex") return "Codex";
  if (coreKind === "claude") return "Claude Code";
  if (coreKind === "pi") return "π";
  return i18n.t("sidebar.unknownCore");
}

export function SidebarCoreSelector({
  coreKind,
  locked,
  busy,
  codexAvailable,
  codexUnavailableReason,
  piAvailable = true,
  piUnavailableReason,
  attentionItems,
  onChange,
  onOpenSearch,
  onSelectAttentionThread,
}: SidebarCoreSelectorProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [attentionOpen, setAttentionOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const editable = !locked && !busy;

  useEffect(() => {
    if (!open) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  useEffect(() => {
    if (!editable) setOpen(false);
  }, [editable]);

  return (
    <div ref={rootRef} className="sidebar-core-selector">
      {editable ? (
        <button
          type="button"
          className="sidebar-core-heading is-editable"
          aria-label={t("sidebar.currentCore", { core: coreDisplayName(coreKind) })}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => {
            setAttentionOpen(false);
            setOpen((current) => !current);
          }}
        >
          <span>{coreDisplayName(coreKind)}</span>
          <ChevronDown size={15} aria-hidden />
        </button>
      ) : (
        <div className="sidebar-core-heading">{coreDisplayName(coreKind)}</div>
      )}

      <div className="sidebar-core-actions">
        <button
          type="button"
          className="sidebar-core-search"
          aria-label={t("nav.search")}
          title={t("nav.search")}
          onClick={() => {
            setOpen(false);
            setAttentionOpen(false);
            onOpenSearch();
          }}
        >
          <Search size={17} aria-hidden />
        </button>
        <SidebarAttentionButton
          items={attentionItems}
          open={attentionOpen}
          onOpenChange={(next) => {
            if (next) setOpen(false);
            setAttentionOpen(next);
          }}
          onSelectThread={onSelectAttentionThread}
        />
      </div>

      {open ? (
        <div className="sidebar-core-menu" role="menu" aria-label={t("sidebar.selectCore")}>
          {coreOptions.map((option) => {
            const selected = option.kind === coreKind;
            const unavailable =
              (option.kind === "codex" && !codexAvailable) ||
              (option.kind === "pi" && !piAvailable);
            const unavailableReason =
              option.kind === "codex"
                ? codexUnavailableReason
                : option.kind === "pi"
                  ? piUnavailableReason
                  : undefined;
            return (
              <button
                key={option.kind}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                className={selected ? "is-selected" : ""}
                disabled={unavailable}
                title={unavailable ? unavailableReason : undefined}
                onClick={() => {
                  onChange(option.kind);
                  setOpen(false);
                }}
              >
                <span className="sidebar-core-menu-label">
                  <img className="sidebar-core-icon" src={option.iconSrc} alt="" aria-hidden="true" />
                  <span>{option.label}</span>
                </span>
                {selected ? <Check size={15} aria-hidden /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
