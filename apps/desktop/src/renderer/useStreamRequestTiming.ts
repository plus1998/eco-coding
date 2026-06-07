import { useEffect, useRef, useState } from "react";

export type StreamRequestTimingPhase = "idle" | "waiting" | "done";

export interface StreamRequestTiming {
  phase: StreamRequestTimingPhase;
  /** Elapsed ms while waiting for the first token (updates live). */
  waitingMs: number;
  /** Backward-compatible live elapsed ms for compact labels. */
  elapsedMs: number;
  /** Time to first token after waiting ends; undefined until recorded. */
  ttftMs?: number;
}

/**
 * Tracks wall-clock wait until the first streamed content byte arrives.
 * `active` should be true while the request is in flight with no content yet.
 * `hasContent` flips true on the first non-empty streamed chunk.
 */
export function useStreamRequestTiming(active: boolean, hasContent: boolean): StreamRequestTiming {
  const [waitingMs, setWaitingMs] = useState(0);
  const [ttftMs, setTtftMs] = useState<number | undefined>();
  const startedAtRef = useRef<number | undefined>(undefined);
  const recordedRef = useRef(false);

  useEffect(() => {
    if (!active) {
      startedAtRef.current = undefined;
      setWaitingMs(0);
      if (!recordedRef.current) {
        setTtftMs(undefined);
      }
      return;
    }

    if (!startedAtRef.current) {
      startedAtRef.current = performance.now();
    }

    const tick = () => {
      if (startedAtRef.current) {
        setWaitingMs(Math.max(0, performance.now() - startedAtRef.current));
      }
    };
    tick();
    const interval = setInterval(tick, 100);
    return () => clearInterval(interval);
  }, [active, hasContent]);

  useEffect(() => {
    if (!active || !hasContent || recordedRef.current || !startedAtRef.current) {
      return;
    }
    recordedRef.current = true;
    setTtftMs(Math.max(0, performance.now() - startedAtRef.current));
    startedAtRef.current = undefined;
  }, [active, hasContent]);

  const phase: StreamRequestTimingPhase = ttftMs !== undefined ? "done" : active ? "waiting" : "idle";

  return { phase, waitingMs, elapsedMs: waitingMs, ...(ttftMs !== undefined && { ttftMs }) };
}
