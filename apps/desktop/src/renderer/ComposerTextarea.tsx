import {
  type ClipboardEvent,
  type KeyboardEvent,
  forwardRef,
  useCallback,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
} from "react";
import type { SkillInfo } from "../shared/skills";
import { ComposerPromptHighlight } from "./ComposerPromptHighlight";

export interface ComposerTextareaProps {
  value: string;
  onChange: (value: string) => void;
  skillsByName: ReadonlyMap<string, SkillInfo>;
  disabled?: boolean | undefined;
  placeholder?: string | undefined;
  maxHeight?: number | undefined;
  onKeyDown?: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onPaste?: (event: ClipboardEvent<HTMLTextAreaElement>) => void;
  onCursorChange?: (cursor: number) => void;
}

export const ComposerTextarea = forwardRef<HTMLTextAreaElement, ComposerTextareaProps>(
  function ComposerTextarea(
    {
      value,
      onChange,
      skillsByName,
      disabled,
      placeholder,
      maxHeight = 200,
      onKeyDown,
      onPaste,
      onCursorChange,
    },
    ref,
  ) {
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const highlightRef = useRef<HTMLDivElement>(null);

    useImperativeHandle(ref, () => textareaRef.current as HTMLTextAreaElement);

    const fitHeight = useCallback(
      (textarea: HTMLTextAreaElement) => {
        textarea.style.height = "0px";
        const next = Math.min(textarea.scrollHeight, maxHeight);
        textarea.style.height = `${next}px`;
        textarea.style.overflowY = textarea.scrollHeight > maxHeight ? "auto" : "hidden";
      },
      [maxHeight],
    );

    useLayoutEffect(() => {
      const textarea = textareaRef.current;
      if (textarea) {
        fitHeight(textarea);
      }
    }, [value, fitHeight]);

    const syncScroll = () => {
      const textarea = textareaRef.current;
      const highlight = highlightRef.current;
      if (!textarea || !highlight) {
        return;
      }
      highlight.scrollTop = textarea.scrollTop;
      highlight.scrollLeft = textarea.scrollLeft;
    };

    const syncCursor = (textarea: HTMLTextAreaElement) => {
      onCursorChange?.(textarea.selectionStart ?? 0);
    };

    const hasSkillTokens = /\$[a-zA-Z0-9][a-zA-Z0-9_-]*/.test(value);

    return (
      <div
        className={
          hasSkillTokens
            ? "codex-composer-input-stack has-skill-tokens"
            : "codex-composer-input-stack"
        }
      >
        <div ref={highlightRef} className="composer-prompt-highlight" aria-hidden>
          <ComposerPromptHighlight text={value} skillsByName={skillsByName} />
        </div>
        <textarea
          ref={textareaRef}
          className="codex-composer-input-control"
          value={value}
          disabled={disabled}
          placeholder={placeholder}
          rows={1}
          spellCheck={false}
          autoCorrect="off"
          autoComplete="off"
          autoCapitalize="off"
          onChange={(event) => {
            onChange(event.target.value);
            syncCursor(event.currentTarget);
            fitHeight(event.currentTarget);
          }}
          onClick={(event) => syncCursor(event.currentTarget)}
          onKeyUp={(event) => syncCursor(event.currentTarget)}
          onSelect={(event) => syncCursor(event.currentTarget)}
          onScroll={syncScroll}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
        />
      </div>
    );
  },
);
