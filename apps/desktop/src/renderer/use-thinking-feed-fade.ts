import { useLayoutEffect, useRef, useState } from "react";

const FADE_OUT_MS = 140;

export function useThinkingFeedFade(
  streaming: boolean | undefined,
  feedIndex: number | undefined,
): boolean {
  const prevIndexRef = useRef<number | undefined>(undefined);
  const [fading, setFading] = useState(false);

  useLayoutEffect(() => {
    if (!streaming || feedIndex === undefined) {
      prevIndexRef.current = feedIndex;
      setFading(false);
      return;
    }
    const previous = prevIndexRef.current;
    if (previous !== undefined && previous !== feedIndex) {
      setFading(true);
      const timer = window.setTimeout(() => setFading(false), FADE_OUT_MS);
      prevIndexRef.current = feedIndex;
      return () => clearTimeout(timer);
    }
    prevIndexRef.current = feedIndex;
  }, [streaming, feedIndex]);

  return fading;
}
