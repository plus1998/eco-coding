import { useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

export interface ExpandablePreBlockProps {
  text: string;
  className?: string;
  preClassName?: string;
  wrapClassName?: string;
  fadeClassName?: string;
  hintClassName?: string;
  maxCollapsedHeight?: number;
  singleLine?: boolean;
  collapsedLabel?: string;
  expandedLabel?: string;
}

export function ExpandablePreBlock({
  text,
  className,
  preClassName,
  wrapClassName,
  fadeClassName,
  hintClassName,
  maxCollapsedHeight = 160,
  singleLine = false,
  collapsedLabel,
  expandedLabel,
}: ExpandablePreBlockProps) {
  const { t } = useTranslation();
  const resolvedCollapsedLabel = collapsedLabel ?? t("common.expand");
  const resolvedExpandedLabel = expandedLabel ?? t("common.collapse");
  const bodyRef = useRef<HTMLPreElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [canToggle, setCanToggle] = useState(false);

  useLayoutEffect(() => {
    setCanToggle(false);
    const body = bodyRef.current;
    if (!body || expanded) {
      return;
    }

    const measure = () => {
      if (body.scrollHeight > body.clientHeight + 1 || body.scrollWidth > body.clientWidth + 1) {
        setCanToggle(true);
      }
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(body);
    return () => observer.disconnect();
  }, [text, expanded, maxCollapsedHeight, singleLine]);

  function toggleExpanded() {
    if (!canToggle) {
      return;
    }
    setExpanded((value) => !value);
  }

  return (
    <div className={className}>
      <button
        type="button"
        className={[
          wrapClassName,
          !expanded ? "collapsed" : "expanded",
          singleLine ? "is-single-line" : "",
          canToggle ? "is-toggleable" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        onClick={toggleExpanded}
        disabled={!canToggle}
        aria-expanded={canToggle ? expanded : undefined}
        title={canToggle && !expanded ? text : undefined}
      >
        <pre
          ref={bodyRef}
          className={[
            preClassName,
            !expanded ? "collapsed" : "",
            singleLine && !expanded ? "is-single-line" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          style={!expanded && !singleLine ? { maxHeight: maxCollapsedHeight } : undefined}
        >
          {text}
        </pre>
        {canToggle && !expanded && !singleLine ? (
          <span className={fadeClassName} aria-hidden>
            <span className={hintClassName}>{resolvedCollapsedLabel}</span>
          </span>
        ) : null}
      </button>
      {canToggle && expanded ? (
        <button type="button" className={hintClassName} onClick={() => setExpanded(false)}>
          {resolvedExpandedLabel}
        </button>
      ) : null}
    </div>
  );
}
