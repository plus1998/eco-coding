import { useCallback, useEffect, useMemo, useState } from "react";
import {
  collectLocalImageSrcs,
  resolveLocalImageDataUrls,
  rewriteLocalImageSrcs,
  type MarkdownLocalImageContext,
} from "./markdown-local-images";
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
  /** When set, relative / workspace-local image srcs are loaded via readWorkspaceFile. */
  localImageContext?: MarkdownLocalImageContext;
}

function canUseProseMirrorHost(): boolean {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

export function MarkdownContent({ text, className, localImageContext }: MarkdownContentProps) {
  if (!text.trim()) {
    return null;
  }

  const rootClass = className ? `markdown-content ${className}` : "markdown-content";

  // SSR / renderToStaticMarkup (tests): emit HTML from the same PM document model.
  if (!canUseProseMirrorHost()) {
    return <div className={rootClass} dangerouslySetInnerHTML={{ __html: renderFeedMarkdownHtml(text) }} />;
  }

  return (
    <MarkdownContentProseMirror
      text={text}
      className={rootClass}
      {...(localImageContext ? { localImageContext } : {})}
    />
  );
}

function MarkdownContentProseMirror({
  text,
  className,
  localImageContext,
}: {
  text: string;
  className: string;
  localImageContext?: MarkdownLocalImageContext;
}) {
  const plugins = useMemo(() => FEED_MARKDOWN_PLUGINS, []);
  const serializeDoc = useMemo(() => () => "__feed_markdown__", []);
  const [urlBySrc, setUrlBySrc] = useState<ReadonlyMap<string, string>>(() => new Map());
  const [imageEpoch, setImageEpoch] = useState(0);

  useEffect(() => {
    if (!localImageContext?.workspacePath || !localImageContext.filePath) {
      setUrlBySrc(new Map());
      return;
    }

    const api = window.eco as
      | {
          readWorkspaceFile?(input: {
            workspacePath: string;
            filePath: string;
          }): Promise<{
            kind: string;
            mimeType?: string;
            base64?: string;
            content?: string;
          }>;
        }
      | undefined;
    if (!api?.readWorkspaceFile) {
      setUrlBySrc(new Map());
      return;
    }

    let cancelled = false;
    const doc = createFeedMarkdownDoc(text);
    const srcs = collectLocalImageSrcs(doc);
    if (srcs.length === 0) {
      setUrlBySrc(new Map());
      return;
    }

    void resolveLocalImageDataUrls({
      workspacePath: localImageContext.workspacePath,
      markdownFilePath: localImageContext.filePath,
      srcs,
      readFile: (request) => api.readWorkspaceFile!(request),
    }).then((map) => {
      if (cancelled) return;
      setUrlBySrc(map);
      setImageEpoch((value) => value + 1);
    });

    return () => {
      cancelled = true;
    };
  }, [text, localImageContext?.workspacePath, localImageContext?.filePath]);

  const createDoc = useCallback(
    (value: string) => {
      const doc = createFeedMarkdownDoc(value);
      return rewriteLocalImageSrcs(doc, urlBySrc);
    },
    [urlBySrc],
  );

  return (
    <div className={className}>
      <ProseMirrorHost
        key={`md-images:${imageEpoch}`}
        className="pm-feed-markdown"
        schema={feedMarkdownSchema}
        plugins={plugins.length > 0 ? plugins : EMPTY_PM_PLUGINS}
        content={text}
        createDoc={createDoc}
        serializeDoc={serializeDoc}
        readOnly
        editable={false}
      />
    </div>
  );
}
