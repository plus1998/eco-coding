import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useActivityFeedLayoutChange } from "./activity-feed-layout-context";
import { MarkdownContent } from "./MarkdownContent";
import { resolveStreamingDisplaySnapshot } from "./streaming-display-text";
import { isStructuralStreamingTail, partitionStreamingMarkdown } from "./streaming-markdown-partition";
import { usePacedStreamText } from "./use-paced-stream-text";

interface StreamingMarkdownContentProps {
  text: string;
  streaming?: boolean;
  className?: string;
  onRevealStateChange?: (revealing: boolean) => void;
}

export function StreamingMarkdownContent({
  text,
  streaming = false,
  className,
  onRevealStateChange,
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
  // A short prose tail benefits from live Markdown spacing. Once the mutable
  // tail grows large, reparsing the entire response on every paced tick costs
  // more than the visual benefit; keep it as text until the turn settles.
  const renderMutableTailAsMarkdown = !structuralTail && tail.length <= 800;
  const layoutSignature = renderAsStreaming
    ? `${stable.length}:${tail.length}:${structuralTail ? "struct" : "live"}:${snapshot.pendingBlock ? "pending" : "open"}:${text.length}`
    : "";
  const wasStreamingRef = useRef(renderAsStreaming);
  const wasStructuralTailRef = useRef(structuralTail);

  useEffect(() => {
    onRevealStateChange?.(revealing);
  }, [onRevealStateChange, revealing]);

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

    // Keep short prose tails as Markdown so block margins remain stable. Large
    // tails use the same plain path as fences/tables and are parsed once when
    // streaming finishes.
    if (renderMutableTailAsMarkdown) {
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
          {showTail ? <div className="markdown-content markdown-content--streaming-plain">{tail}</div> : null}
        </div>
      </div>
    );
  }

  return <MarkdownContent text={renderText} {...(className && { className })} />;
}
