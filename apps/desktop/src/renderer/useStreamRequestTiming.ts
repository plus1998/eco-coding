import { useEffect, useMemo, useRef, useState } from "react";
import {
  computeRequestSpanTtftMs,
  computeRequestSpanWaitingMs,
  type RequestSpanTimingFields,
} from "../shared/request-span-timing";

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

export interface StreamRequestTimingAnchor {
  startedAtIso?: string;
  firstTokenAtIso?: string;
}

function toRequestSpanTimingFields(anchor: StreamRequestTimingAnchor): RequestSpanTimingFields | undefined {
  if (!anchor.startedAtIso) {
    return undefined;
  }
  return {
    status: anchor.firstTokenAtIso ? "streaming" : "waiting_first_token",
    startedAt: anchor.startedAtIso,
    ...(anchor.firstTokenAtIso && { firstTokenAt: anchor.firstTokenAtIso }),
  };
}

/**
 * Tracks wall-clock wait until the first streamed content byte arrives.
 * `active` should be true while the request is in flight with no content yet.
 * `hasContent` flips true on the first non-empty streamed chunk.
 */
export function useStreamRequestTiming(
  active: boolean,
  hasContent: boolean,
  anchor?: StreamRequestTimingAnchor,
): StreamRequestTiming {
  const [waitingMs, setWaitingMs] = useState(0);
  const [ttftMs, setTtftMs] = useState<number | undefined>();
  const startedAtRef = useRef<number | undefined>(undefined);
  const recordedRef = useRef(false);
  const startedAtIso = anchor?.startedAtIso;
  const firstTokenAtIso = anchor?.firstTokenAtIso;
  const persistedFields = useMemo(
    () =>
      startedAtIso
        ? toRequestSpanTimingFields({ startedAtIso, ...(firstTokenAtIso && { firstTokenAtIso }) })
        : undefined,
    [firstTokenAtIso, startedAtIso],
  );
  const persistedTtftMs = persistedFields ? computeRequestSpanTtftMs(persistedFields) : undefined;

  useEffect(() => {
    if (persistedTtftMs !== undefined) {
      setTtftMs(persistedTtftMs);
      recordedRef.current = true;
      setWaitingMs(0);
      return;
    }

    if (!active) {
      startedAtRef.current = undefined;
      setWaitingMs(0);
      if (!recordedRef.current) {
        setTtftMs(undefined);
      }
      return;
    }

    if (persistedFields && !hasContent) {
      const tick = () => setWaitingMs(computeRequestSpanWaitingMs(persistedFields));
      tick();
      const interval = setInterval(tick, 100);
      return () => clearInterval(interval);
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
  }, [active, hasContent, persistedFields, persistedTtftMs]);

  useEffect(() => {
    if (persistedTtftMs !== undefined) {
      return;
    }
    if (!hasContent || recordedRef.current) {
      return;
    }
    recordedRef.current = true;
    if (persistedFields) {
      const startedMs = Date.parse(persistedFields.startedAt);
      setTtftMs(
        Number.isFinite(startedMs) ? Math.max(0, Date.now() - startedMs) : Math.max(0, performance.now() - (startedAtRef.current ?? performance.now())),
      );
    } else if (startedAtRef.current) {
      setTtftMs(Math.max(0, performance.now() - startedAtRef.current));
    }
    startedAtRef.current = undefined;
  }, [hasContent, persistedFields, persistedTtftMs]);

  const phase: StreamRequestTimingPhase =
    ttftMs !== undefined ? "done" : active ? "waiting" : "idle";

  return { phase, waitingMs, elapsedMs: waitingMs, ...(ttftMs !== undefined && { ttftMs }) };
}
