import { useCallback, useEffect, useRef, useState } from "react";

export const PACED_STREAM_INTERVAL_MS = 24;

const graphemeSegmenter =
  typeof Intl.Segmenter === "function" ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : null;

export function splitStreamingTextUnits(text: string): string[] {
  if (!text) {
    return [];
  }
  if (!graphemeSegmenter) {
    return Array.from(text);
  }
  return Array.from(graphemeSegmenter.segment(text), (part) => part.segment);
}

export function resolvePacedRevealCount(pendingCount: number, streaming: boolean): number {
  if (pendingCount <= 0) {
    return 0;
  }
  if (!streaming) {
    return Math.min(pendingCount, Math.max(4, Math.ceil(pendingCount / 3)));
  }
  if (pendingCount > 120) {
    return 8;
  }
  if (pendingCount > 60) {
    return 4;
  }
  if (pendingCount > 24) {
    return 2;
  }
  return 1;
}

export function revealPacedText(current: string, target: string, streaming: boolean): string {
  if (current === target) {
    return current;
  }
  if (!target.startsWith(current)) {
    return target;
  }

  const pendingUnits = readStreamingTextPrefixUnits(target.slice(current.length), 121);
  const revealCount = resolvePacedRevealCount(pendingUnits.length, streaming);
  return current + pendingUnits.slice(0, revealCount).join("");
}

function readStreamingTextPrefixUnits(text: string, limit: number): string[] {
  if (!graphemeSegmenter) {
    return Array.from(text).slice(0, limit);
  }
  const units: string[] = [];
  for (const part of graphemeSegmenter.segment(text)) {
    units.push(part.segment);
    if (units.length >= limit) {
      break;
    }
  }
  return units;
}

/** Keeps the first received batch immediate, then smooths later append-only stream updates. */
export function usePacedStreamText(text: string, streaming: boolean): string {
  const [displayText, setDisplayText] = useState(text);
  const displayTextRef = useRef(text);
  const targetTextRef = useRef(text);
  const streamingRef = useRef(streaming);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleRef = useRef<() => void>(() => undefined);

  const schedule = useCallback(() => {
    if (timerRef.current !== null || displayTextRef.current === targetTextRef.current) {
      return;
    }
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      const nextText = revealPacedText(displayTextRef.current, targetTextRef.current, streamingRef.current);
      if (nextText !== displayTextRef.current) {
        displayTextRef.current = nextText;
        setDisplayText(nextText);
      }
      scheduleRef.current();
    }, PACED_STREAM_INTERVAL_MS);
  }, []);
  scheduleRef.current = schedule;

  useEffect(() => {
    targetTextRef.current = text;
    streamingRef.current = streaming;

    if (!displayTextRef.current && text) {
      displayTextRef.current = text;
      setDisplayText(text);
      return;
    }
    if (!text.startsWith(displayTextRef.current)) {
      displayTextRef.current = text;
      setDisplayText(text);
      return;
    }
    schedule();
  }, [text, streaming, schedule]);

  useEffect(
    () => () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
      }
    },
    [],
  );

  return displayText;
}
