import { forwardRef, useMemo } from "react";
import { ansiToHtml } from "../shared/ansi-html";

interface AnsiOutputProps {
  text: string;
  className?: string;
  placeholder?: string;
}

export const AnsiOutput = forwardRef<HTMLPreElement, AnsiOutputProps>(function AnsiOutput(
  { text, className, placeholder },
  ref,
) {
  const html = useMemo(() => {
    if (!text) {
      return escapeHtml(placeholder ?? "");
    }
    return ansiToHtml(text);
  }, [placeholder, text]);

  return (
    <pre
      ref={ref}
      className={className}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
});

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
