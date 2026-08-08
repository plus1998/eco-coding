import { useLayoutEffect, useMemo } from "react";
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

  useLayoutEffect(() => {
    if (!renderAsStreaming || !layoutSignature) {
      return;
    }
    onLayoutChange?.();
  }, [renderAsStreaming, layoutSignature, onLayoutChange]);

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
