import type { CoreKind } from "@eco/runtime/core-runtime";
import { Check, ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";

interface SidebarCoreSelectorProps {
  coreKind: CoreKind | undefined;
  locked: boolean;
  busy: boolean;
  codexAvailable: boolean;
  codexUnavailableReason?: string;
  onChange: (coreKind: CoreKind) => void;
}

const coreOptions: Array<{ kind: CoreKind; label: string }> = [
  { kind: "codex", label: "Codex" },
  { kind: "claude", label: "Claude Code" },
];

export function coreDisplayName(coreKind: CoreKind | undefined): string {
  if (coreKind === "codex") return "Codex";
  if (coreKind === "claude") return "Claude Code";
  return "Core 未知";
}

export function SidebarCoreSelector({
  coreKind,
  locked,
  busy,
  codexAvailable,
  codexUnavailableReason,
  onChange,
}: SidebarCoreSelectorProps) {
  const [open, setOpen] = useState(false);
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
          aria-label={`当前 Core：${coreDisplayName(coreKind)}，点击切换`}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
        >
          <span>{coreDisplayName(coreKind)}</span>
          <ChevronDown size={15} aria-hidden />
        </button>
      ) : (
        <div className="sidebar-core-heading">{coreDisplayName(coreKind)}</div>
      )}

      {open ? (
        <div className="sidebar-core-menu" role="menu" aria-label="选择 Core">
          {coreOptions.map((option) => {
            const selected = option.kind === coreKind;
            const unavailable = option.kind === "codex" && !codexAvailable;
            return (
              <button
                key={option.kind}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                className={selected ? "is-selected" : ""}
                disabled={unavailable}
                title={unavailable ? codexUnavailableReason : undefined}
                onClick={() => {
                  onChange(option.kind);
                  setOpen(false);
                }}
              >
                <span>{option.label}</span>
                {selected ? <Check size={15} aria-hidden /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
