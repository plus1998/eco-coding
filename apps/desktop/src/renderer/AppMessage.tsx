import { useEffect } from "react";

export type AppMessageKind = "success" | "error";

interface AppMessageProps {
  message: string;
  kind?: AppMessageKind;
  onDismiss: () => void;
  durationMs?: number;
}

export function AppMessage({
  message,
  kind = "success",
  onDismiss,
  durationMs = kind === "error" ? 4800 : 3200,
}: AppMessageProps) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, durationMs);
    return () => clearTimeout(timer);
  }, [message, durationMs, onDismiss]);

  return (
    <div
      className={kind === "error" ? "app-message app-message-error" : "app-message"}
      role={kind === "error" ? "alert" : "status"}
      aria-live={kind === "error" ? "assertive" : "polite"}
    >
      {message}
    </div>
  );
}

export function formatDurationMs(ms: number): string {
  if (ms < 1000) {
    return `${Math.round(ms)}ms`;
  }
  return `${(ms / 1000).toFixed(1)}s`;
}
