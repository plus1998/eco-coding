import { type KeyboardEvent, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

export interface ExpandablePreBlockProps {
  text: string;
  className?: string;
  preClassName?: string;
  wrapClassName?: string;
  fadeClassName?: string;
  hintClassName?: string;
  maxCollapsedHeight?: number;
  /** When set, expanded content is capped and scrolls inside the pre. */
  maxExpandedHeight?: number;
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
  maxExpandedHeight,
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

  function onWrapKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!canToggle || expanded) {
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      toggleExpanded();
    }
  }

  const maxHeight = singleLine
    ? undefined
    : expanded
      ? maxExpandedHeight
      : maxCollapsedHeight;

  return (
    <div className={className}>
      {/*
        Use a div (not <button>) so expanded overflow scrolling works reliably;
        browsers often clip overflow on button descendants.
      */}
      <div
        className={[
          wrapClassName,
          !expanded ? "collapsed" : "expanded",
          singleLine ? "is-single-line" : "",
          canToggle && !expanded ? "is-toggleable" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        role={canToggle && !expanded ? "button" : undefined}
        tabIndex={canToggle && !expanded ? 0 : undefined}
        onClick={canToggle && !expanded ? toggleExpanded : undefined}
        onKeyDown={canToggle && !expanded ? onWrapKeyDown : undefined}
        aria-expanded={canToggle ? expanded : undefined}
        title={canToggle && !expanded ? text : undefined}
      >
        <pre
          ref={bodyRef}
          className={[
            preClassName,
            !expanded ? "collapsed" : "expanded",
            singleLine && !expanded ? "is-single-line" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          style={
            maxHeight != null
              ? {
                  maxHeight: expanded ? `min(40vh, ${maxHeight}px)` : maxHeight,
                }
              : undefined
          }
        >
          {text}
        </pre>
        {canToggle && !expanded && !singleLine ? (
          <span className={fadeClassName} aria-hidden>
            <span className={hintClassName}>{resolvedCollapsedLabel}</span>
          </span>
        ) : null}
      </div>
      {canToggle && expanded ? (
        <button type="button" className={hintClassName} onClick={() => setExpanded(false)}>
          {resolvedExpandedLabel}
        </button>
      ) : null}
    </div>
  );
}
