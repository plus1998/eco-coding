import { motion, useReducedMotion } from "framer-motion";
import { useLayoutEffect, useRef, useState } from "react";

export interface RollingBillingDigit {
  key: string;
  value: number;
}

export type RollingBillingSlot =
  | { kind: "digit"; key: string; value: string; digit: RollingBillingDigit }
  | { kind: "static"; key: string; value: string };

export function splitBillingAmount(formatted: string): RollingBillingSlot[] {
  const slots: RollingBillingSlot[] = [];
  let digitIndex = 0;
  for (const character of formatted) {
    if (/\d/.test(character)) {
      slots.push({
        kind: "digit",
        key: `digit-${digitIndex++}`,
        value: character,
        digit: { key: `digit-${digitIndex - 1}`, value: Number(character) },
      });
    } else {
      slots.push({ kind: "static", key: `static-${slots.length}`, value: character });
    }
  }
  return slots;
}

export function shouldRollBillingAmount(
  previousValue: number | undefined,
  nextValue: number,
  previousFormatted: string | undefined,
  nextFormatted: string,
  sameSession: boolean,
): boolean {
  return (
    previousValue !== undefined &&
    sameSession &&
    Number.isFinite(previousValue) &&
    Number.isFinite(nextValue) &&
    nextValue > previousValue &&
    previousFormatted !== nextFormatted
  );
}

const BILLING_REEL_DIGITS = Array.from({ length: 10 }, (_, digit) => digit);

export function billingDigitOffsetPercent(digit: number): number {
  const normalizedDigit = ((Math.trunc(digit) % 10) + 10) % 10;
  return -normalizedDigit * 10;
}

function srOnlyText(text: string) {
  return <span className="sr-only">{text}</span>;
}

export function RollingBillingAmount({
  value,
  formatted,
  resetKey,
  className,
}: {
  value: number;
  formatted: string;
  resetKey?: string;
  className?: string;
}) {
  const reducedMotion = useReducedMotion();
  const previous = useRef<{ value: number; formatted: string; resetKey?: string } | null>(null);
  const animationSequence = useRef(0);
  const [animation, setAnimation] = useState<{
    fromFormatted: string;
    toFormatted: string;
    resetKey: string | undefined;
    key: string;
  } | null>(null);

  useLayoutEffect(() => {
    const prior = previous.current;
    const sameSession = prior !== null && prior.resetKey === resetKey;
    const shouldRoll =
      !reducedMotion &&
      shouldRollBillingAmount(prior?.value, value, prior?.formatted, formatted, sameSession);

    previous.current = {
      value,
      formatted,
      ...(resetKey !== undefined ? { resetKey } : {}),
    };

    if (shouldRoll && prior) {
      animationSequence.current += 1;
      setAnimation({
        fromFormatted: prior.formatted,
        toFormatted: formatted,
        resetKey,
        key: `${resetKey ?? ""}:${formatted}:${animationSequence.current}`,
      });
      return;
    }

    if (
      reducedMotion ||
      prior === null ||
      prior.resetKey !== resetKey ||
      prior.formatted !== formatted
    ) {
      setAnimation(null);
    }
  }, [value, formatted, resetKey, reducedMotion]);

  const activeAnimation =
    animation?.toFormatted === formatted && animation.resetKey === resetKey ? animation : null;

  if (!activeAnimation) {
    return (
      <span className={className}>
        <span className="rolling-billing-visual" aria-hidden="true">
          {formatted}
        </span>
        {srOnlyText(formatted)}
      </span>
    );
  }

  const previousSlots = splitBillingAmount(activeAnimation.fromFormatted);
  const nextSlots = splitBillingAmount(activeAnimation.toFormatted);
  const previousDigits = previousSlots.filter((slot) => slot.kind === "digit");
  const nextDigits = nextSlots.filter((slot) => slot.kind === "digit");
  const compatible =
    previousSlots.length === nextSlots.length &&
    previousSlots.every((slot, index) => {
      const next = nextSlots[index];
      return (
        next !== undefined && slot.kind === next.kind && (slot.kind === "digit" || slot.value === next.value)
      );
    });
  const animationKey = activeAnimation.key;

  if (!compatible) {
    return (
      <span className={className}>
        <span
          key={animationKey}
          className="rolling-billing-visual rolling-billing-visual--flipping"
          aria-hidden="true"
        >
          <span className="rolling-billing-swap">
            <motion.span
              className="rolling-billing-swap-face"
              initial={{ y: "0%", rotateX: 0, opacity: 1 }}
              animate={{ y: "72%", rotateX: -78, opacity: 0 }}
              transition={{ duration: 0.44, ease: [0.55, 0, 1, 0.45] }}
            >
              {activeAnimation.fromFormatted}
            </motion.span>
            <motion.span
              className="rolling-billing-swap-face"
              initial={{ y: "-72%", rotateX: 78, opacity: 0 }}
              animate={{ y: "0%", rotateX: 0, opacity: 1 }}
              transition={{ duration: 0.68, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
            >
              {formatted}
            </motion.span>
          </span>
        </span>
        {srOnlyText(formatted)}
      </span>
    );
  }

  let digitIndex = 0;
  return (
    <span className={className}>
      <span
        className="rolling-billing-visual rolling-billing-visual--spinning"
        aria-hidden="true"
      >
        {nextSlots.map((slot) => {
          if (slot.kind === "static") {
            return <span key={slot.key}>{slot.value}</span>;
          }
          const previousDigit = previousDigits[digitIndex];
          const nextDigit = nextDigits[digitIndex++];
          if (!previousDigit || !nextDigit) {
            return (
              <span className="rolling-billing-digit" key={slot.key}>
                {slot.value}
              </span>
            );
          }

          return (
            <span
              className={`rolling-billing-digit${
                previousDigit.digit.value === nextDigit.digit.value
                  ? ""
                  : " rolling-billing-digit--active"
              }`}
              key={slot.key}
            >
              <motion.span
                className="rolling-billing-reel"
                initial={{ y: `${billingDigitOffsetPercent(previousDigit.digit.value)}%` }}
                animate={{ y: `${billingDigitOffsetPercent(nextDigit.digit.value)}%` }}
                transition={{ duration: 1.2, ease: [0.1, 0.8, 0.2, 1] }}
              >
                {BILLING_REEL_DIGITS.map((digit) => (
                  <span className="rolling-billing-glyph" key={`${slot.key}-${digit}`}>
                    {digit}
                  </span>
                ))}
              </motion.span>
            </span>
          );
        })}
      </span>
      {srOnlyText(formatted)}
    </span>
  );
}
