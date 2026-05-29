import { ChevronLeft, ChevronRight, Info } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { ClarificationAnswers, ClarificationRequest } from "../shared/ipc";

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

  const question = request.questions[questionIndex];
  const optionCount = question?.options.length ?? 0;

  const recommendedIndex = useMemo(() => {
    if (!question) {
      return -1;
    }
    return question.options.findIndex((option) => option.recommended);
  }, [question]);

  useEffect(() => {
    setHighlightIndex(recommendedIndex >= 0 ? recommendedIndex : 0);
    if (!question) {
      return;
    }
    setSelections((current) => {
      if ((current[questionIndex]?.length ?? 0) > 0) {
        return current;
      }
      const recommended = question.options.find((option) => option.recommended);
      if (!recommended) {
        return current;
      }
      const next = current.map((row) => [...row]);
      next[questionIndex] = [recommended.label];
      return next;
    });
  }, [questionIndex, question, recommendedIndex]);

  function selectOption(optionLabel: string) {
    if (!question) {
      return;
    }
    setSelections((current) => {
      const next = current.map((row) => [...row]);
      if (question.multiSelect) {
        const row = next[questionIndex] ?? [];
        next[questionIndex] = row.includes(optionLabel)
          ? row.filter((item) => item !== optionLabel)
          : [...row, optionLabel];
      } else {
        next[questionIndex] = [optionLabel];
      }
      return next;
    });
  }

  function submitAll(currentSelections: string[][]) {
    onSubmit({ toolUseId: request.toolUseId, selections: currentSelections });
  }

  function continueFlow() {
    if (!question || (selections[questionIndex]?.length ?? 0) === 0) {
      return;
    }
    if (questionIndex >= total - 1) {
      submitAll(selections);
      return;
    }
    setQuestionIndex((index) => index + 1);
  }

  const currentSelection = selections[questionIndex] ?? [];
  const hasSelection = currentSelection.length > 0;
  const isLastQuestion = questionIndex >= total - 1;

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (busy || !question) {
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        onDismiss();
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
        const option = question.options[highlightIndex];
        if (!option) {
          return;
        }
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
          const ready = (next[questionIndex]?.length ?? 0) > 0;
          if (ready) {
            if (questionIndex >= total - 1) {
              submitAll(next);
            } else {
              setQuestionIndex((index) => index + 1);
            }
          }
          return next;
        });
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, question, highlightIndex, optionCount, questionIndex, total, onDismiss, request.toolUseId]);

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
              disabled={busy || questionIndex >= total - 1 || !hasSelection}
              onClick={() => setQuestionIndex((index) => index + 1)}
              aria-label="下一题"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        ) : null}
      </header>

      <ul className="clarification-option-list" role="listbox" aria-label="选项">
        {question.options.map((option, optionIndex) => {
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

      <footer className="clarification-footer">
        <button type="button" className="clarification-dismiss" disabled={busy} onClick={onDismiss}>
          忽略 <kbd>ESC</kbd>
        </button>
        <button
          type="button"
          className="clarification-continue"
          disabled={busy || !hasSelection}
          onClick={continueFlow}
        >
          {isLastQuestion ? "继续" : "下一题"} <kbd>↵</kbd>
        </button>
      </footer>
    </section>
  );
}
