import { useCallback, useEffect, useState } from "react";

export type AppMessageKind = "success" | "error" | "info";

export interface AppMessageState {
  kind: AppMessageKind;
  message: string;
}

interface AppMessageProps {
  message: string;
  kind?: AppMessageKind;
  onDismiss: () => void;
  durationMs?: number;
}

const DEFAULT_DURATION_MS: Record<AppMessageKind, number> = {
  success: 3200,
  error: 5200,
  info: 3600,
};

export function useAppMessage() {
  const [state, setState] = useState<AppMessageState | undefined>();

  const dismiss = useCallback(() => {
    setState(undefined);
  }, []);

  const show = useCallback((kind: AppMessageKind, message: string) => {
    setState({ kind, message });
  }, []);

  return {
    state,
    dismiss,
    showSuccess: (message: string) => show("success", message),
    showError: (message: string) => show("error", message),
    showInfo: (message: string) => show("info", message),
  };
}

export function AppMessage({
  message,
  kind = "success",
  onDismiss,
  durationMs = DEFAULT_DURATION_MS[kind],
}: AppMessageProps) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, durationMs);
    return () => clearTimeout(timer);
  }, [message, durationMs, onDismiss, kind]);

  return (
    <div
      className={`app-message app-message--${kind}`}
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

/** Strip Electron's `Error invoking remote method '…': Error: …` wrapper for UI display. */
export function formatIpcInvokeError(caught: unknown, fallback = "操作失败"): string {
  const raw = caught instanceof Error ? caught.message : String(caught);
  const stripped = raw
    .replace(/^Error invoking remote method '[^']+':\s*/i, "")
    .replace(/^Error:\s*/i, "")
    .trim();
  return stripped || fallback;
}
