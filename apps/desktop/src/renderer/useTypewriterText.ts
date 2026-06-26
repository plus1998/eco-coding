import { useEffect, useRef, useState } from "react";

export const DEFAULT_TYPEWRITER_CHARS_PER_SECOND = 72;

export interface TypewriterOptions {
  charsPerSecond?: number;
}

export function useTypewriterText(
  targetText: string,
  streaming: boolean,
  options: TypewriterOptions = {},
): { visibleText: string; catchingUp: boolean } {
  const charsPerSecond = options.charsPerSecond ?? DEFAULT_TYPEWRITER_CHARS_PER_SECOND;
  const [visibleLength, setVisibleLength] = useState(() =>
    streaming ? 0 : targetText.length,
  );
  const visibleLengthRef = useRef(visibleLength);
  const targetRef = useRef(targetText);
  const rafRef = useRef<number | null>(null);
  const lastFrameRef = useRef<number | null>(null);
  const carryRef = useRef(0);

  useEffect(() => {
    targetRef.current = targetText;
    if (!streaming) {
      visibleLengthRef.current = targetText.length;
      setVisibleLength(targetText.length);
      carryRef.current = 0;
      return;
    }
    if (targetText.length < visibleLengthRef.current) {
      visibleLengthRef.current = 0;
      setVisibleLength(0);
      lastFrameRef.current = null;
      carryRef.current = 0;
    }
  }, [targetText, streaming]);

  useEffect(() => {
    if (!streaming) {
      return undefined;
    }

    const step = (now: number) => {
      const target = targetRef.current;
      const current = visibleLengthRef.current;
      if (current >= target.length) {
        rafRef.current = requestAnimationFrame(step);
        return;
      }
      const last = lastFrameRef.current ?? now;
      lastFrameRef.current = now;
      const elapsed = Math.max(0, now - last);
      carryRef.current += (elapsed / 1000) * charsPerSecond;
      const advance = Math.floor(carryRef.current);
      if (advance <= 0) {
        rafRef.current = requestAnimationFrame(step);
        return;
      }
      carryRef.current -= advance;
      const next = Math.min(target.length, current + advance);
      visibleLengthRef.current = next;
      setVisibleLength(next);
      rafRef.current = requestAnimationFrame(step);
    };

    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      lastFrameRef.current = null;
    };
  }, [streaming, charsPerSecond]);

  const catchingUp = streaming && visibleLength < targetText.length;
  return {
    visibleText: targetText.slice(0, visibleLength),
    catchingUp,
  };
}
