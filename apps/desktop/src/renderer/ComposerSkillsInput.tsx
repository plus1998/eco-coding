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
import {
  getCursorOffset,
  getSelectionOffsets,
  insertPlainTextAtSelection,
  renderEditablePrompt,
  serializeEditable,
  setCursorOffset,
  setSelectionOffsets,
} from "./composer-skills-editable";

export interface ComposerSkillsInputHandle {
  focus: () => void;
  scrollIntoView: (options?: ScrollIntoViewOptions) => void;
  getSelectionStart: () => number;
  getSelectionEnd: () => number;
  setCursor: (offset: number) => void;
  setSelection: (start: number, end: number) => void;
  fitHeight: () => void;
}

interface ComposerSkillsInputProps {
  value: string;
  onChange: (value: string) => void;
  skillsByName: ReadonlyMap<string, SkillInfo>;
  disabled?: boolean | undefined;
  placeholder?: string | undefined;
  maxHeight?: number | undefined;
  onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void;
  onPaste?: (event: ClipboardEvent<HTMLDivElement>) => void;
  onCursorChange?: (cursor: number) => void;
}

export const ComposerSkillsInput = forwardRef<ComposerSkillsInputHandle, ComposerSkillsInputProps>(
  function ComposerSkillsInput(
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
    const editorRef = useRef<HTMLDivElement>(null);
    const isComposingRef = useRef(false);
    const skillsByNameRef = useRef(skillsByName);
    skillsByNameRef.current = skillsByName;

    const fitHeight = useCallback(
      (editor: HTMLDivElement) => {
        editor.style.height = "0px";
        const next = Math.min(editor.scrollHeight, maxHeight);
        editor.style.height = `${next}px`;
        editor.style.overflowY = editor.scrollHeight > maxHeight ? "auto" : "hidden";
      },
      [maxHeight],
    );

    useImperativeHandle(
      ref,
      () => ({
        focus: () => editorRef.current?.focus(),
        scrollIntoView: (options) => editorRef.current?.scrollIntoView(options),
        getSelectionStart: () =>
          editorRef.current ? getSelectionOffsets(editorRef.current).start : 0,
        getSelectionEnd: () => (editorRef.current ? getCursorOffset(editorRef.current) : 0),
        setCursor: (offset) => {
          if (editorRef.current) {
            setCursorOffset(editorRef.current, offset);
          }
        },
        setSelection: (start, end) => {
          if (editorRef.current) {
            setSelectionOffsets(editorRef.current, start, end);
          }
        },
        fitHeight: () => {
          if (editorRef.current) {
            fitHeight(editorRef.current);
          }
        },
      }),
      [fitHeight],
    );

    const syncDomFromValue = useCallback(() => {
      const editor = editorRef.current;
      if (!editor || isComposingRef.current) {
        return;
      }
      const serialized = serializeEditable(editor);
      if (serialized === value) {
        return;
      }
      const { start, end } = getSelectionOffsets(editor);
      renderEditablePrompt(editor, value, skillsByNameRef.current);
      const nextStart = Math.min(start, value.length);
      const nextEnd = Math.min(end, value.length);
      setSelectionOffsets(editor, nextStart, nextEnd);
    }, [value]);

    useLayoutEffect(() => {
      const editor = editorRef.current;
      if (!editor) {
        return;
      }
      syncDomFromValue();
      fitHeight(editor);
    }, [value, fitHeight, syncDomFromValue]);

    useLayoutEffect(() => {
      const editor = editorRef.current;
      if (!editor || isComposingRef.current || !value.includes("$")) {
        return;
      }
      if (serializeEditable(editor) !== value) {
        return;
      }
      const { start, end } = getSelectionOffsets(editor);
      renderEditablePrompt(editor, value, skillsByNameRef.current);
      setSelectionOffsets(editor, start, end);
    }, [skillsByName, value]);

    const commitEditorValue = useCallback(() => {
      const editor = editorRef.current;
      if (!editor) {
        return;
      }
      const next = serializeEditable(editor);
      onChange(next);
      onCursorChange?.(getCursorOffset(editor));
      fitHeight(editor);
    }, [onChange, onCursorChange, fitHeight]);

    const handleInput = () => {
      if (isComposingRef.current) {
        const editor = editorRef.current;
        if (editor) {
          fitHeight(editor);
        }
        return;
      }
      commitEditorValue();
    };

    const handleCompositionStart = () => {
      isComposingRef.current = true;
    };

    const handleCompositionEnd = () => {
      isComposingRef.current = false;
      commitEditorValue();
    };

    const syncCursor = () => {
      if (isComposingRef.current) {
        return;
      }
      const editor = editorRef.current;
      if (editor) {
        onCursorChange?.(getCursorOffset(editor));
      }
    };

    const handlePaste = (event: ClipboardEvent<HTMLDivElement>) => {
      if (onPaste) {
        onPaste(event);
        if (event.defaultPrevented) {
          return;
        }
      }
      const text = event.clipboardData.getData("text/plain");
      if (!text) {
        return;
      }
      event.preventDefault();
      insertPlainTextAtSelection(text);
      handleInput();
    };

    return (
      <div className="composer-skill-input">
        <div
          ref={editorRef}
          className="composer-skill-input-control"
          contentEditable={disabled ? false : true}
          suppressContentEditableWarning
          role="textbox"
          aria-multiline="true"
          data-placeholder={placeholder}
          spellCheck={false}
          onInput={handleInput}
          onCompositionStart={handleCompositionStart}
          onCompositionEnd={handleCompositionEnd}
          onClick={syncCursor}
          onKeyUp={syncCursor}
          onPaste={handlePaste}
          onKeyDown={onKeyDown}
        />
      </div>
    );
  },
);
