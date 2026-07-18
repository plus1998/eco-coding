import { useLayoutEffect } from "react";
import { useActivityFeedLayoutChange } from "./activity-feed-layout-context";
import { MarkdownContent } from "./MarkdownContent";
import { resolveStreamingDisplaySnapshot } from "./streaming-display-text";

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
  const renderText = streaming ? snapshot.displayText : text;
  const layoutSignature = streaming
    ? `${renderText.length}:${snapshot.pendingBlock ? "pending" : "open"}:${text.length}`
    : "";

  useLayoutEffect(() => {
    if (!streaming || !layoutSignature) {
      return;
    }
    onLayoutChange?.();
  }, [streaming, layoutSignature, onLayoutChange]);

  if (streaming) {
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

  return <MarkdownContent text={text} {...(className && { className })} />;
}
