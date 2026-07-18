import { useLayoutEffect } from "react";
import { useActivityFeedLayoutChange } from "./activity-feed-layout-context";
import { MarkdownContent } from "./MarkdownContent";
import { resolveStreamingDisplaySnapshot } from "./streaming-display-text";
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
  const layoutSignature = renderAsStreaming
    ? `${renderText.length}:${snapshot.pendingBlock ? "pending" : "open"}:${text.length}`
    : "";

  useLayoutEffect(() => {
    if (!renderAsStreaming || !layoutSignature) {
      return;
    }
    onLayoutChange?.();
  }, [renderAsStreaming, layoutSignature, onLayoutChange]);

  if (renderAsStreaming) {
    const hasRenderableText = renderText.trim().length > 0;
    if (!hasRenderableText) {
      return null;
    }
    return (
      <div
        className={
          className ? `markdown-content--streaming-wrap ${className}` : "markdown-content--streaming-wrap"
        }
      >
        <div className="markdown-content--streaming-body">
          <MarkdownContent text={renderText} />
        </div>
      </div>
    );
  }

  return <MarkdownContent text={renderText} {...(className && { className })} />;
}
