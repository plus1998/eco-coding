import { useLayoutEffect, useMemo, useRef } from "react";
import { useActivityFeedLayoutChange } from "./activity-feed-layout-context";
import { MarkdownContent } from "./MarkdownContent";
import { resolveStreamingDisplaySnapshot } from "./streaming-display-text";
import {
  isStructuralStreamingTail,
  partitionStreamingMarkdown,
} from "./streaming-markdown-partition";
import { usePacedStreamText } from "./use-paced-stream-text";

interface StreamingMarkdownContentProps {
  text: string;
  streaming?: boolean;
  className?: string;
}

export function StreamingMarkdownContent({
  text,
  streaming = false,
  className,
}: StreamingMarkdownContentProps) {
  const onLayoutChange = useActivityFeedLayoutChange();
  const snapshot = resolveStreamingDisplaySnapshot(text, streaming);
  const targetText = streaming ? snapshot.displayText : text;
  const renderText = usePacedStreamText(targetText, streaming);
  const revealing = renderText !== targetText;
  const renderAsStreaming = streaming || revealing;
  const { stable, tail } = useMemo(
    () => partitionStreamingMarkdown(renderText, renderAsStreaming),
    [renderText, renderAsStreaming],
  );
  const structuralTail = renderAsStreaming && isStructuralStreamingTail(tail);
  const layoutSignature = renderAsStreaming
    ? `${stable.length}:${tail.length}:${structuralTail ? "struct" : "live"}:${snapshot.pendingBlock ? "pending" : "open"}:${text.length}`
    : "";
  const wasStreamingRef = useRef(renderAsStreaming);
  const wasStructuralTailRef = useRef(structuralTail);

  useLayoutEffect(() => {
    const wasStreaming = wasStreamingRef.current;
    const wasStructuralTail = wasStructuralTailRef.current;
    wasStreamingRef.current = renderAsStreaming;
    wasStructuralTailRef.current = structuralTail;
    if (renderAsStreaming) {
      if (!layoutSignature) {
        return;
      }
      // Plain table/fence tails snap to a real table in one frame — stick immediately
      // so Chromium overflow-anchor cannot walk the feed off the bottom.
      const structuralSnap = wasStructuralTail !== structuralTail;
      onLayoutChange?.(structuralSnap ? { immediate: true } : undefined);
      return;
    }
    if (wasStreaming) {
      onLayoutChange?.({ immediate: true });
    }
  }, [renderAsStreaming, layoutSignature, structuralTail, onLayoutChange]);

  if (renderAsStreaming) {
    const showStable = stable.trim().length > 0;
    const showTail = tail.length > 0;
    // Empty after holds (e.g. incomplete SEARCH-only) → leave Feed tail as loading host.
    if (!showStable && !showTail) {
      return null;
    }

    // Prose-only mutable tails stream as full markdown so block margins / list density
    // do not snap when the incomplete block later commits or the run settles.
    if (!structuralTail) {
      return <MarkdownContent text={renderText} {...(className && { className })} />;
    }

    return (
      <div
        className={
          className ? `markdown-content--streaming-wrap ${className}` : "markdown-content--streaming-wrap"
        }
      >
        <div className="markdown-content--streaming-body">
          {showStable ? (
            <MarkdownContent text={stable} className="markdown-content--streaming-stable" />
          ) : null}
          {showTail ? (
            <div className="markdown-content markdown-content--streaming-plain">{tail}</div>
          ) : null}
        </div>
      </div>
    );
  }

  return <MarkdownContent text={renderText} {...(className && { className })} />;
}
