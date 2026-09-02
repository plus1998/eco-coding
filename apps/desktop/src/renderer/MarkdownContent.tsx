import { useMemo } from "react";
import {
  createFeedMarkdownDoc,
  FEED_MARKDOWN_PLUGINS,
  feedMarkdownSchema,
  renderFeedMarkdownHtml,
} from "./prosemirror/feed-markdown";
import { EMPTY_PM_PLUGINS, ProseMirrorHost } from "./prosemirror/ProseMirrorHost";

interface MarkdownContentProps {
  text: string;
  className?: string;
}

function canUseProseMirrorHost(): boolean {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

export function MarkdownContent({ text, className }: MarkdownContentProps) {
  if (!text.trim()) {
    return null;
  }

  const rootClass = className ? `markdown-content ${className}` : "markdown-content";

  // SSR / renderToStaticMarkup (tests): emit HTML from the same PM document model.
  if (!canUseProseMirrorHost()) {
    return <div className={rootClass} dangerouslySetInnerHTML={{ __html: renderFeedMarkdownHtml(text) }} />;
  }

  return <MarkdownContentProseMirror text={text} className={rootClass} />;
}

function MarkdownContentProseMirror({ text, className }: { text: string; className: string }) {
  const plugins = useMemo(() => FEED_MARKDOWN_PLUGINS, []);
  const serializeDoc = useMemo(() => () => "__feed_markdown__", []);

  return (
    <div className={className}>
      <ProseMirrorHost
        className="pm-feed-markdown"
        schema={feedMarkdownSchema}
        plugins={plugins.length > 0 ? plugins : EMPTY_PM_PLUGINS}
        content={text}
        createDoc={createFeedMarkdownDoc}
        serializeDoc={serializeDoc}
        readOnly
        editable={false}
      />
    </div>
  );
}
