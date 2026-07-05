import { useLayoutEffect } from "react";
import { useActivityFeedLayoutChange } from "./activity-feed-layout-context";
import { MarkdownContent } from "./MarkdownContent";
import { StreamingTypingIndicator } from "./StreamingTypingIndicator";
import { resolveStreamingDisplaySnapshot } from "./streaming-display-text";

interface StreamingMarkdownContentProps {
  text: string;
  streaming?: boolean;
  className?: string;
}

function StreamBlockLoading({ kind }: { kind?: string }) {
  const label =
    kind === "bash"
      ? "等待 Bash 代码块"
      : kind === "diff" || kind === "file"
        ? "等待文件变更块"
        : "等待代码块";
  return (
    <div
      className="markdown-streaming-block-loading"
      {...(kind && { "data-kind": kind })}
      role="status"
      aria-label={label}
    >
      <span className="run-log-projection-loading" aria-hidden>
        <span />
        <span />
        <span />
      </span>
      <span className="markdown-streaming-block-loading-label">{label}</span>
    </div>
  );
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
    if (!hasRenderableText && !snapshot.pendingBlock) {
      return null;
    }
    return (
      <div
        className={
          className ? `markdown-content--streaming-wrap ${className}` : "markdown-content--streaming-wrap"
        }
      >
        {hasRenderableText ? (
          <div className="markdown-content--streaming-body">
            <MarkdownContent text={renderText} />
            {!snapshot.pendingBlock ? (
              <div className="markdown-content--streaming-tail" role="status" aria-label="正在输出">
                <StreamingTypingIndicator />
              </div>
            ) : null}
          </div>
        ) : null}
        {snapshot.pendingBlock ? (
          <StreamBlockLoading {...(snapshot.pendingKind && { kind: snapshot.pendingKind })} />
        ) : null}
      </div>
    );
  }

  return <MarkdownContent text={text} {...(className && { className })} />;
}
