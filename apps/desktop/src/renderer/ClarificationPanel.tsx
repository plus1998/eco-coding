import { ChevronLeft, ChevronRight, Info, Loader2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ClarificationAnswers, ClarificationRequest } from "../shared/ipc";
import {
  CLARIFICATION_CUSTOM_OPTION_LABEL,
  isClarificationQuestionReady,
  optionRequiresCustomExplanation,
  resolveClarificationQuestionAnswer,
} from "../shared/clarification";

interface ClarificationPanelProps {
  request: ClarificationRequest;
  busy?: boolean;
  onSubmit: (answers: ClarificationAnswers) => void;
  onDismiss: () => void;
}

export function ClarificationPanel({ request, busy, onSubmit, onDismiss }: ClarificationPanelProps) {
  const total = request.questions.length;
  const [questionIndex, setQuestionIndex] = useState(0);
  const [highlightIndex, setHighlightIndex] = useState(0);
  const [selections, setSelections] = useState<string[][]>(() => request.questions.map(() => []));
  const [customTexts, setCustomTexts] = useState<string[]>(() => request.questions.map(() => ""));
  const customInputRef = useRef<HTMLTextAreaElement>(null);

  const question = request.questions[questionIndex];
  const displayOptions = useMemo(() => {
    if (!question) {
      return [];
    }
    const hasCustomRow = question.options.some(
      (option) => option.label === CLARIFICATION_CUSTOM_OPTION_LABEL,
    );
    if (hasCustomRow) {
      return question.options;
    }
    return [
      ...question.options,
      { label: CLARIFICATION_CUSTOM_OPTION_LABEL, description: "在下方输入框填写你的说明" },
    ];
  }, [question]);

  const optionCount = displayOptions.length;

  const recommendedIndex = useMemo(() => {
    if (!question) {
      return -1;
    }
    return displayOptions.findIndex((option) => option.recommended);
  }, [question, displayOptions]);

  const currentSelection = selections[questionIndex] ?? [];
  const currentCustomText = customTexts[questionIndex] ?? "";
  const questionReady = isClarificationQuestionReady(currentSelection, currentCustomText);
  const showCustomInput = currentSelection.includes(CLARIFICATION_CUSTOM_OPTION_LABEL);

  useEffect(() => {
    setHighlightIndex(recommendedIndex >= 0 ? recommendedIndex : 0);
    if (!question) {
      return;
    }
    setSelections((current) => {
      if ((current[questionIndex]?.length ?? 0) > 0) {
        return current;
      }
      const recommended = displayOptions.find((option) => option.recommended);
      if (!recommended) {
        return current;
      }
      const next = current.map((row) => [...row]);
      next[questionIndex] = [recommended.label];
      return next;
    });
  }, [questionIndex, question, recommendedIndex, displayOptions]);

  useEffect(() => {
    if (!showCustomInput || busy) {
      return;
    }
    customInputRef.current?.focus();
  }, [showCustomInput, questionIndex, busy]);

  function advanceToNextQuestionIfReady(nextSelection: string[]) {
    if (!question || question.multiSelect || questionIndex >= total - 1) {
      return;
    }
    const customText = customTexts[questionIndex] ?? "";
    if (!isClarificationQuestionReady(nextSelection, customText)) {
      return;
    }
    if (nextSelection.includes(CLARIFICATION_CUSTOM_OPTION_LABEL) && !customText.trim()) {
      return;
    }
    setQuestionIndex((index) => index + 1);
  }

  function selectOption(optionLabel: string) {
    if (!question) {
      return;
    }
    setSelections((current) => {
      const next = current.map((row) => [...row]);
      let nextSelection: string[] = [];
      if (question.multiSelect) {
        const row = next[questionIndex] ?? [];
        if (optionLabel === CLARIFICATION_CUSTOM_OPTION_LABEL) {
          next[questionIndex] = row.includes(optionLabel)
            ? row.filter((item) => item !== optionLabel)
            : [...row.filter((item) => item !== CLARIFICATION_CUSTOM_OPTION_LABEL), optionLabel];
        } else {
          next[questionIndex] = row.includes(optionLabel)
            ? row.filter((item) => item !== optionLabel)
            : [...row, optionLabel];
        }
        nextSelection = next[questionIndex] ?? [];
      } else {
        next[questionIndex] = [optionLabel];
        nextSelection = next[questionIndex] ?? [];
        if (optionLabel !== CLARIFICATION_CUSTOM_OPTION_LABEL) {
          queueMicrotask(() => advanceToNextQuestionIfReady(nextSelection));
        }
      }
      return next;
    });
  }

  function buildFinalSelections(): string[][] {
    return request.questions.map((_, index) =>
      resolveClarificationQuestionAnswer(selections[index] ?? [], customTexts[index] ?? ""),
    );
  }

  function submitAll() {
    onSubmit({ toolUseId: request.toolUseId, selections: buildFinalSelections() });
  }

  function continueFlow() {
    if (!question || !questionReady) {
      return;
    }
    if (questionIndex >= total - 1) {
      submitAll();
      return;
    }
    setQuestionIndex((index) => index + 1);
  }

  const isLastQuestion = questionIndex >= total - 1;

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (busy || !question) {
        return;
      }
      const target = event.target as HTMLElement | null;
      const inCustomField = target?.tagName === "TEXTAREA";

      if (event.key === "Escape") {
        event.preventDefault();
        onDismiss();
        return;
      }
      if (inCustomField) {
        if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && questionReady) {
          event.preventDefault();
          if (questionIndex >= total - 1) {
            submitAll();
          } else {
            setQuestionIndex((index) => index + 1);
          }
        }
        return;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setHighlightIndex((index) => (index + 1) % Math.max(optionCount, 1));
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setHighlightIndex((index) => (index - 1 + Math.max(optionCount, 1)) % Math.max(optionCount, 1));
        return;
      }
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        const option = displayOptions[highlightIndex];
        if (!option) {
          return;
        }
        let nextSelection: string[] = [];
        setSelections((current) => {
          const next = current.map((row) => [...row]);
          if (question.multiSelect) {
            const row = next[questionIndex] ?? [];
            next[questionIndex] = row.includes(option.label)
              ? row.filter((item) => item !== option.label)
              : [...row, option.label];
          } else {
            next[questionIndex] = [option.label];
          }
          nextSelection = next[questionIndex] ?? [];
          return next;
        });
        const readyAfterSelect = isClarificationQuestionReady(
          nextSelection,
          customTexts[questionIndex] ?? "",
        );
        if (!readyAfterSelect) {
          return;
        }
        if (questionIndex >= total - 1) {
          submitAll();
        } else {
          setQuestionIndex((index) => index + 1);
        }
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    busy,
    question,
    highlightIndex,
    optionCount,
    questionIndex,
    total,
    onDismiss,
    displayOptions,
    questionReady,
    selections,
    customTexts,
  ]);

  if (!question) {
    return null;
  }

  return (
    <section className="clarification-panel codex-style" aria-label="澄清问题">
      <header className="clarification-top">
        <p className="clarification-title">{question.question}</p>
        {total > 1 ? (
          <div className="clarification-pagination" aria-label={`第 ${questionIndex + 1} 题，共 ${total} 题`}>
            <button
              type="button"
              className="clarification-page-btn"
              disabled={busy || questionIndex === 0}
              onClick={() => setQuestionIndex((index) => index - 1)}
              aria-label="上一题"
            >
              <ChevronLeft size={16} />
            </button>
            <span className="clarification-page-label">
              {questionIndex + 1} / {total}
            </span>
            <button
              type="button"
              className="clarification-page-btn"
              disabled={busy || questionIndex >= total - 1 || !questionReady}
              onClick={() => setQuestionIndex((index) => index + 1)}
              aria-label="下一题"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        ) : null}
      </header>

      <ul className="clarification-option-list" role="listbox" aria-label="选项">
        {displayOptions.map((option, optionIndex) => {
          const selected = currentSelection.includes(option.label);
          const highlighted = highlightIndex === optionIndex;
          return (
            <li key={option.label}>
              <button
                type="button"
                role="option"
                aria-selected={selected}
                className={[
                  "clarification-option-row",
                  selected ? "is-selected" : "",
                  highlighted ? "is-highlighted" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                disabled={busy}
                onMouseEnter={() => setHighlightIndex(optionIndex)}
                onClick={() => selectOption(option.label)}
              >
                <span className="clarification-option-index">{optionIndex + 1}.</span>
                <span className="clarification-option-body">
                  <span className="clarification-option-label">
                    {option.label}
                    {option.recommended ? (
                      <span className="clarification-recommended">（推荐）</span>
                    ) : null}
                  </span>
                  {option.description ? (
                    <span className="clarification-option-desc">{option.description}</span>
                  ) : null}
                </span>
                {option.description ? (
                  <span className="clarification-info" title={option.description}>
                    <Info size={14} aria-hidden />
                  </span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>

      {showCustomInput ? (
        <div className="clarification-custom">
          <label className="clarification-custom-label" htmlFor={`clarification-custom-${request.toolUseId}`}>
            自定义说明
            {!currentCustomText.trim() ? (
              <span className="clarification-custom-required">（必填）</span>
            ) : null}
          </label>
          <textarea
            id={`clarification-custom-${request.toolUseId}`}
            ref={customInputRef}
            className="clarification-custom-input"
            disabled={busy}
            rows={3}
            placeholder="在此输入你的说明。"
            value={currentCustomText}
            onChange={(event) => {
              const value = event.target.value;
              setCustomTexts((current) => {
                const next = [...current];
                next[questionIndex] = value;
                return next;
              });
            }}
          />
          <p className="clarification-custom-hint">提交时将使用此处文字作为回答（不会提交「其他」字样本身）。</p>
        </div>
      ) : null}

      <footer className="clarification-footer">
        <button type="button" className="clarification-dismiss" disabled={busy} onClick={onDismiss}>
          {busy ? (
            <>
              <Loader2 size={14} className="spinning" aria-hidden />
              处理中…
            </>
          ) : (
            <>
              忽略 <kbd>ESC</kbd>
            </>
          )}
        </button>
        <button
          type="button"
          className="clarification-continue"
          disabled={busy || !questionReady}
          onClick={continueFlow}
        >
          {busy ? (
            <>
              <Loader2 size={14} className="spinning" aria-hidden />
              提交中…
            </>
          ) : (
            <>
              {isLastQuestion ? "确认提交" : "下一题"} <kbd>↵</kbd>
            </>
          )}
        </button>
      </footer>
    </section>
  );
}
