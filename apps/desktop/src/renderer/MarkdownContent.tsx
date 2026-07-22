import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

const markdownRemarkPlugins = [remarkGfm];
const markdownComponents: Components = {
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noreferrer noopener">
      {children}
    </a>
  ),
  pre: ({ children }) => <pre className="markdown-pre">{children}</pre>,
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
      <ReactMarkdown remarkPlugins={markdownRemarkPlugins} components={markdownComponents}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
