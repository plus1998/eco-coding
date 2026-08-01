import { Check, Copy, WrapText } from "lucide-react";
import { Children, isValidElement, type ReactNode, useState } from "react";
import ReactMarkdown, { type Components, defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import { i18n } from "./i18n";
import { MaterialFileIcon } from "./MaterialFileIcon";
import {
  dispatchWorkspaceFileReference,
  formatWorkspaceFileReferenceLabel,
  parseWorkspaceFileReferenceHref,
  type WorkspaceFileReference,
  workspaceFileReferenceRemarkPlugin,
} from "./workspace-file-reference";

const markdownRemarkPlugins = [remarkGfm, workspaceFileReferenceRemarkPlugin];

function markdownUrlTransform(url: string): string {
  if (url.startsWith("eco-file:")) {
    return url;
  }
  return defaultUrlTransform(url);
}

function codeTextFromNode(node: ReactNode): string {
  return String(node ?? "").replace(/\n$/, "");
}

function extractFencedCodeMeta(children: ReactNode): {
  language: string;
  codeElement: ReactNode;
  text: string;
} {
  const child = Children.toArray(children).find((node) => isValidElement(node));
  if (!isValidElement<{ className?: string; children?: ReactNode }>(child)) {
    return { language: "text", codeElement: children, text: codeTextFromNode(children) };
  }
  const className = child.props.className ?? "";
  const match = /language-([^\s]+)/.exec(className);
  return {
    language: (match?.[1] ?? "text").toLowerCase(),
    codeElement: child,
    text: codeTextFromNode(child.props.children),
  };
}

function MarkdownWorkspaceFileLink({ href, reference }: { href: string; reference: WorkspaceFileReference }) {
  const label = formatWorkspaceFileReferenceLabel(reference);
  const title =
    reference.line !== undefined
      ? `${reference.path}:${reference.line}${reference.column !== undefined ? `:${reference.column}` : ""}`
      : reference.path;

  return (
    <a
      href={href}
      className="markdown-file-ref"
      title={title}
      onClick={(event) => {
        event.preventDefault();
        dispatchWorkspaceFileReference(reference);
      }}
    >
      <MaterialFileIcon path={reference.path} size={14} className="markdown-file-ref__icon" />
      <span className="markdown-file-ref__label">{label}</span>
    </a>
  );
}

function MarkdownCodeBlock({ children }: { children?: ReactNode }) {
  const { language, codeElement, text } = extractFencedCodeMeta(children);
  const [copied, setCopied] = useState(false);
  const [wrap, setWrap] = useState(false);
  const copyLabel = i18n.t("common.copy");
  const wrapLabel = wrap ? i18n.t("markdown.code.unwrap") : i18n.t("markdown.code.wrap");

  function handleCopy() {
    if (!navigator.clipboard) {
      return;
    }
    void navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1400);
      })
      .catch(() => undefined);
  }

  return (
    <div className={wrap ? "markdown-code-block is-wrap" : "markdown-code-block"}>
      <div className="markdown-code-block__toolbar">
        <span className="markdown-code-block__language">{language}</span>
        <div className="markdown-code-block__actions">
          <button
            type="button"
            className={wrap ? "markdown-code-block__action is-active" : "markdown-code-block__action"}
            onClick={() => setWrap((value) => !value)}
            aria-label={wrapLabel}
            aria-pressed={wrap}
            title={wrapLabel}
          >
            <WrapText size={14} aria-hidden />
          </button>
          <button
            type="button"
            className="markdown-code-block__action"
            onClick={handleCopy}
            aria-label={copyLabel}
            title={copyLabel}
          >
            {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
          </button>
        </div>
      </div>
      <pre className="markdown-pre">{codeElement}</pre>
    </div>
  );
}

const markdownComponents: Components = {
  a: ({ href, children }) => {
    const reference = parseWorkspaceFileReferenceHref(href);
    if (reference) {
      return <MarkdownWorkspaceFileLink href={href ?? "#"} reference={reference} />;
    }
    return (
      <a href={href} target="_blank" rel="noreferrer noopener">
        {children}
      </a>
    );
  },
  pre: ({ children }) => <MarkdownCodeBlock>{children}</MarkdownCodeBlock>,
  code: ({ className: codeClassName, children }) =>
    codeClassName ? (
      <code className={codeClassName}>{children}</code>
    ) : (
      <code className="markdown-inline-code">{children}</code>
    ),
};

interface MarkdownContentProps {
  text: string;
  className?: string;
}

export function MarkdownContent({ text, className }: MarkdownContentProps) {
  if (!text.trim()) {
    return null;
  }

  return (
    <div className={className ? `markdown-content ${className}` : "markdown-content"}>
      <ReactMarkdown
        remarkPlugins={markdownRemarkPlugins}
        urlTransform={markdownUrlTransform}
        components={markdownComponents}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
