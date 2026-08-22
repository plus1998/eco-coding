import { Check, ChevronDown, CircleAlert } from "lucide-react";
import {
  Children,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  clampComposerFloatingLeft,
  composerFloatingAvailableWidth,
} from "./composer-floating";

interface ComposerFieldSelectProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean | undefined;
  /** Rendered as the placeholder option's label when no value is selected. */
  placeholder?: string | undefined;
  /** Rendered as the placeholder option when value is empty. */
  showPlaceholder?: boolean | undefined;
  title?: string | undefined;
  /** Highlight the trigger in red with a warning icon. */
  invalid?: boolean | undefined;
  invalidLabel?: string | undefined;
  children: ReactNode;
}

interface ComposerFieldOption {
  value: string;
  label: string;
}

function textFromReactNode(node: ReactNode): string {
  if (node == null || typeof node === "boolean") {
    return "";
  }
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map(textFromReactNode).join("");
  }
  const props = (node as { props?: { children?: ReactNode } }).props;
  return props ? textFromReactNode(props.children) : "";
}

function optionNodes(children: ReactNode): ComposerFieldOption[] {
  const result: ComposerFieldOption[] = [];
  for (const child of Children.toArray(children)) {
    if (child && typeof child === "object" && "type" in child && child.type === "option" && child.props) {
      const props = child.props as { value?: unknown; children?: ReactNode };
      result.push({
        value: props.value == null ? "" : String(props.value),
        label: textFromReactNode(props.children),
      });
    }
  }
  return result;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

const TRIGGER_MIN_WIDTH = 160;
const PANEL_WIDTH = 260;
const ROW_HEIGHT = 32;
const HEADER_HEIGHT = 0;

/**
 * Custom dropdown picker for simple value lists (main agent config, prompt,
 * subagent orchestration). Visually matches the auxiliary/vision model cascade
 * field so all orchestration pickers share one style language, instead of
 * falling back to the native OS `<select>` popup.
 */
export function ComposerFieldSelect({
  value,
  onChange,
  disabled,
  placeholder,
  showPlaceholder,
  title,
  invalid,
  invalidLabel,
  children,
}: ComposerFieldSelectProps) {
  const menuId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [open, setOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [panelStyle, setPanelStyle] = useState<CSSProperties>(() => ({ visibility: "hidden" }));

  const options = useMemo(() => optionNodes(children), [children]);
  const selectedIndex = options.findIndex((option) => option.value === value);
  const selectedOption = selectedIndex >= 0 ? options[selectedIndex] : undefined;
  const showPlaceholderLabel = showPlaceholder && !selectedOption && Boolean(placeholder);
  const triggerLabel = selectedOption?.label ?? (showPlaceholderLabel ? placeholder : "");
  const isPlaceholder = !selectedOption;
  const hasOptions = options.length > 0;

  const updatePanelPosition = useCallback(() => {
    const anchor = triggerRef.current;
    if (!anchor) {
      return;
    }
    const rect = anchor.getBoundingClientRect();
    const margin = 8;
    const availableWidth = composerFloatingAvailableWidth(margin);
    const width = Math.min(PANEL_WIDTH, Math.max(TRIGGER_MIN_WIDTH, Math.min(rect.width, availableWidth)));
    const left = clampComposerFloatingLeft(rect.left, width, margin);
    const spaceAbove = rect.top - margin;
    const spaceBelow = window.innerHeight - rect.bottom - margin;
    const estimatedHeight = HEADER_HEIGHT + options.length * ROW_HEIGHT + 12;
    const minHeight = 88;
    const placeAbove = spaceAbove >= minHeight && spaceAbove >= spaceBelow;
    const availableSpace = Math.max(60, Math.floor(placeAbove ? spaceAbove : spaceBelow));
    const maxHeight = Math.min(estimatedHeight, availableSpace);
    setPanelStyle({
      position: "fixed",
      left,
      width,
      maxHeight,
      zIndex: 10002,
      ...(placeAbove ? { bottom: window.innerHeight - rect.top + 8 } : { top: rect.bottom + 8 }),
    });
  }, [options.length]);

  const closePanel = useCallback((restoreFocus: boolean) => {
    setOpen(false);
    if (restoreFocus) {
      requestAnimationFrame(() => triggerRef.current?.focus());
    }
  }, []);

  const openPanel = useCallback(() => {
    if (disabled || !hasOptions) {
      return;
    }
    setFocusedIndex(Math.max(0, selectedIndex));
    updatePanelPosition();
    setOpen(true);
  }, [disabled, hasOptions, selectedIndex, updatePanelPosition]);

  useLayoutEffect(() => {
    if (!open) {
      return;
    }
    const updatePositions = () => {
      updatePanelPosition();
    };
    updatePanelPosition();
    window.addEventListener("resize", updatePositions);
    window.addEventListener("scroll", updatePositions, true);
    return () => {
      window.removeEventListener("resize", updatePositions);
      window.removeEventListener("scroll", updatePositions, true);
    };
  }, [open, updatePanelPosition]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const frame = requestAnimationFrame(() => buttonRefs.current[focusedIndex]?.focus());
    return () => cancelAnimationFrame(frame);
  }, [focusedIndex, open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    function handlePointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) {
        return;
      }
      closePanel(false);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        closePanel(true);
      } else if (event.key === "Tab") {
        closePanel(false);
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [closePanel, open]);

  function focusAt(index: number) {
    if (options.length === 0) {
      return;
    }
    const nextIndex = clamp(index, 0, options.length - 1);
    setFocusedIndex(nextIndex);
    requestAnimationFrame(() => buttonRefs.current[nextIndex]?.focus());
  }

  function commit(option: ComposerFieldOption) {
    onChange(option.value);
    closePanel(true);
  }

  function handleItemKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusAt(index === options.length - 1 ? 0 : index + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      focusAt(index === 0 ? options.length - 1 : index - 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      focusAt(0);
    } else if (event.key === "End") {
      event.preventDefault();
      focusAt(options.length - 1);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      const option = options[index];
      if (option) {
        commit(option);
      }
    }
  }

  const popover =
    open &&
    createPortal(
      <div
        id={menuId}
        ref={panelRef}
        className="composer-codex-popover composer-field-select-menu"
        role="listbox"
        aria-label={triggerLabel || undefined}
        style={panelStyle}
      >
        <ul className="composer-field-select-menu-list" role="none">
          {options.map((option, index) => {
            const selected = option.value === value;
            return (
              <li key={option.value} role="none">
                <button
                  ref={(node) => {
                    buttonRefs.current[index] = node;
                  }}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  tabIndex={focusedIndex === index ? 0 : -1}
                  className={
                    selected
                      ? "composer-field-select-menu-item is-selected"
                      : "composer-field-select-menu-item"
                  }
                  title={option.label}
                  onMouseEnter={() => setFocusedIndex(index)}
                  onKeyDown={(event) => handleItemKeyDown(event, index)}
                  onClick={() => commit(option)}
                >
                  <span className="composer-field-select-menu-label">{option.label}</span>
                  {selected ? <Check size={14} strokeWidth={2} aria-hidden /> : null}
                </button>
              </li>
            );
          })}
        </ul>
      </div>,
      document.body,
    );

  return (
    <span className="composer-field-select">
      {/* Keep option children mounted (hidden) so callers / SSR / tests can still observe values. */}
      <span className="composer-field-select-options" hidden aria-hidden="true">
        {children}
      </span>
      <button
        ref={triggerRef}
        type="button"
        className={[
          "composer-field-select-trigger",
          open ? "is-active" : "",
          selectedOption ? "has-selection" : "",
          invalid ? "is-invalid" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        disabled={disabled}
        aria-label={triggerLabel || undefined}
        aria-invalid={invalid || undefined}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        title={title ?? (invalid ? invalidLabel : undefined) ?? triggerLabel}
        onKeyDown={(event) => {
          if (!open && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
            event.preventDefault();
            openPanel();
          }
        }}
        onClick={() => {
          if (open) {
            closePanel(false);
          } else {
            openPanel();
          }
        }}
      >
        <span
          className={
            isPlaceholder
              ? "composer-field-select-trigger-label is-placeholder"
              : "composer-field-select-trigger-label"
          }
        >
          {triggerLabel}
        </span>
        {invalid ? (
          <CircleAlert
            size={14}
            strokeWidth={2}
            aria-hidden
            className="composer-field-select-invalid-icon"
          />
        ) : null}
        <ChevronDown
          size={14}
          aria-hidden
          className={open ? "composer-field-select-chevron is-open" : "composer-field-select-chevron"}
        />
      </button>
      {popover}
    </span>
  );
}
