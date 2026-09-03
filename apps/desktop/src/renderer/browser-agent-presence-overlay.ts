import type { BrowserAgentPresenceEvent } from "../shared/browser-agent-presence";
import { resolveBrowserWebviewHostSlot } from "./browser-webview-layout";

const CURSOR_CLASS = "browser-agent-cursor";
const RIPPLE_CLASS = "browser-agent-click-ripple";
const MIST_CLASS = "browser-agent-mist";
const STRIP_CLASS = "browser-agent-light-strip";
const ACTIVE_CLASS = "is-agent-active";
const CLICKING_CLASS = "is-agent-clicking";
const PULSE_CLASS = "is-breath-pulse";
const MOVE_MS = 320;
const DRAG_MOVE_MS = 90;
const PULSE_MS = 920;
const MIST_VERSION = "6";

const MIST_COLORS = ["is-cyan", "is-violet", "is-magenta", "is-amber", "is-mint"] as const;
const MIST_DRIFTS = ["is-drift-a", "is-drift-b", "is-drift-c"] as const;

/**
 * Many small edge-hugging blobs. Positions are % of the overlay frame.
 * Keep them near the rim so the page center stays readable.
 */
const MIST_SPECS: ReadonlyArray<{
  left?: string;
  top?: string;
  right?: string;
  bottom?: string;
  w: number;
  h: number;
}> = [
  // top
  { left: "4%", top: "-3%", w: 88, h: 64 },
  { left: "16%", top: "-4%", w: 72, h: 56 },
  { left: "28%", top: "-2%", w: 80, h: 58 },
  { left: "42%", top: "-5%", w: 70, h: 52 },
  { left: "56%", top: "-3%", w: 78, h: 60 },
  { left: "70%", top: "-4%", w: 74, h: 54 },
  { left: "84%", top: "-2%", w: 82, h: 62 },
  // right
  { right: "-3%", top: "10%", w: 64, h: 86 },
  { right: "-4%", top: "28%", w: 58, h: 78 },
  { right: "-2%", top: "46%", w: 66, h: 84 },
  { right: "-4%", top: "64%", w: 60, h: 76 },
  { right: "-3%", top: "80%", w: 62, h: 72 },
  // bottom
  { left: "6%", bottom: "-3%", w: 84, h: 60 },
  { left: "20%", bottom: "-4%", w: 70, h: 54 },
  { left: "34%", bottom: "-2%", w: 76, h: 58 },
  { left: "50%", bottom: "-5%", w: 68, h: 50 },
  { left: "64%", bottom: "-3%", w: 80, h: 56 },
  { left: "78%", bottom: "-4%", w: 72, h: 52 },
  // left
  { left: "-3%", top: "12%", w: 62, h: 82 },
  { left: "-4%", top: "32%", w: 56, h: 74 },
  { left: "-2%", top: "52%", w: 64, h: 80 },
  { left: "-4%", top: "70%", w: 58, h: 70 },
];

type CursorState = {
  x: number;
  y: number;
  visible: boolean;
  dragging: boolean;
};

const cursorByBrowserId = new Map<string, CursorState>();
const moveTimers = new Map<string, ReturnType<typeof setTimeout>>();
const pulseTimers = new Map<string, ReturnType<typeof setTimeout>>();

function findOverlay(browserId: string): HTMLDivElement | null {
  const slot = resolveBrowserWebviewHostSlot(browserId);
  if (!slot) {
    return null;
  }
  return slot.querySelector<HTMLDivElement>(".browser-panel-overlay-host");
}

function ensureMist(overlay: HTMLDivElement): HTMLDivElement {
  let mist = overlay.querySelector<HTMLDivElement>(`.${MIST_CLASS}`);
  if (mist?.dataset.mistVersion === MIST_VERSION) {
    return mist;
  }
  mist?.remove();
  mist = document.createElement("div");
  mist.className = MIST_CLASS;
  mist.dataset.mistVersion = MIST_VERSION;
  mist.setAttribute("aria-hidden", "true");
  for (let i = 0; i < MIST_SPECS.length; i += 1) {
    const spec = MIST_SPECS[i]!;
    const blob = document.createElement("span");
    const color = MIST_COLORS[i % MIST_COLORS.length]!;
    const drift = MIST_DRIFTS[i % MIST_DRIFTS.length]!;
    blob.className = `browser-agent-mist-blob ${color} ${drift} is-n${(i % 5) + 1}`;
    blob.style.width = `${spec.w}px`;
    blob.style.height = `${spec.h}px`;
    if (spec.left !== undefined) blob.style.left = spec.left;
    if (spec.right !== undefined) blob.style.right = spec.right;
    if (spec.top !== undefined) blob.style.top = spec.top;
    if (spec.bottom !== undefined) blob.style.bottom = spec.bottom;
    // Stagger ambient motion / pulse phase.
    blob.style.animationDelay = `${(-i * 0.37).toFixed(2)}s, ${(-i * 0.51).toFixed(2)}s, ${(-i * 0.23).toFixed(2)}s`;
    mist.append(blob);
  }
  overlay.prepend(mist);
  return mist;
}

function ensureLightStrip(overlay: HTMLDivElement): HTMLDivElement {
  let strip = overlay.querySelector<HTMLDivElement>(`.${STRIP_CLASS}`);
  if (strip?.dataset.stripVersion === MIST_VERSION) {
    return strip;
  }
  strip?.remove();
  strip = document.createElement("div");
  strip.className = STRIP_CLASS;
  strip.dataset.stripVersion = MIST_VERSION;
  strip.setAttribute("aria-hidden", "true");
  // Aura = soft outer bloom; band = sharp holographic sweep ring.
  strip.innerHTML =
    '<span class="browser-agent-holo-aura"></span>' +
    '<span class="browser-agent-holo-band"></span>' +
    '<span class="browser-agent-holo-spinner" aria-hidden="true"></span>';
  const mist = overlay.querySelector(`.${MIST_CLASS}`);
  if (mist?.nextSibling) {
    overlay.insertBefore(strip, mist.nextSibling);
  } else if (mist) {
    mist.after(strip);
  } else {
    overlay.prepend(strip);
  }
  return strip;
}

function ensureCursor(overlay: HTMLDivElement): HTMLDivElement {
  let cursor = overlay.querySelector<HTMLDivElement>(`.${CURSOR_CLASS}`);
  if (cursor?.dataset.cursorVersion === MIST_VERSION) {
    return cursor;
  }
  cursor?.remove();
  cursor = document.createElement("div");
  cursor.className = CURSOR_CLASS;
  cursor.dataset.cursorVersion = MIST_VERSION;
  cursor.setAttribute("aria-hidden", "true");
  cursor.innerHTML = CURSOR_SVG;
  overlay.append(cursor);
  return cursor;
}

function ensureRipple(overlay: HTMLDivElement): HTMLDivElement {
  let ripple = overlay.querySelector<HTMLDivElement>(`.${RIPPLE_CLASS}`);
  if (ripple) {
    return ripple;
  }
  ripple = document.createElement("div");
  ripple.className = RIPPLE_CLASS;
  ripple.setAttribute("aria-hidden", "true");
  overlay.append(ripple);
  return ripple;
}

/** One-shot, restartable breath pulse tied to each Agent action. */
function triggerBreathPulse(overlay: HTMLDivElement, browserId: string): void {
  overlay.classList.remove(PULSE_CLASS);
  void overlay.offsetWidth;
  overlay.classList.add(PULSE_CLASS);
  const prev = pulseTimers.get(browserId);
  if (prev) {
    clearTimeout(prev);
  }
  pulseTimers.set(
    browserId,
    setTimeout(() => {
      overlay.classList.remove(PULSE_CLASS);
      pulseTimers.delete(browserId);
    }, PULSE_MS),
  );
}

function defaultCursorOrigin(overlay: HTMLDivElement): { x: number; y: number } {
  const w = overlay.clientWidth || 400;
  const h = overlay.clientHeight || 300;
  return { x: w * 0.18, y: h * 0.22 };
}

function setCursorPosition(
  cursor: HTMLDivElement,
  x: number,
  y: number,
  animate: boolean,
  durationMs = MOVE_MS,
): void {
  if (!animate) {
    cursor.style.transition = "none";
  } else {
    cursor.style.transition = `transform ${durationMs}ms cubic-bezier(0.22, 1, 0.36, 1)`;
  }
  cursor.style.transform = `translate3d(${x}px, ${y}px, 0)`;
  if (!animate) {
    void cursor.offsetWidth;
    cursor.style.transition = `transform ${durationMs}ms cubic-bezier(0.22, 1, 0.36, 1)`;
  }
}

function applyActive(browserId: string, options?: { pulse?: boolean }): void {
  const overlay = findOverlay(browserId);
  if (!overlay) {
    return;
  }
  overlay.classList.add(ACTIVE_CLASS);
  ensureMist(overlay);
  ensureLightStrip(overlay);
  const cursor = ensureCursor(overlay);
  ensureRipple(overlay);
  if (options?.pulse !== false) {
    triggerBreathPulse(overlay, browserId);
  }
  let state = cursorByBrowserId.get(browserId);
  if (!state) {
    const origin = defaultCursorOrigin(overlay);
    state = { x: origin.x, y: origin.y, visible: true, dragging: false };
    cursorByBrowserId.set(browserId, state);
    setCursorPosition(cursor, state.x, state.y, false);
  }
  cursor.classList.add("is-visible");
}

function applyIdle(browserId: string): void {
  const overlay = findOverlay(browserId);
  if (overlay) {
    overlay.classList.remove(ACTIVE_CLASS, CLICKING_CLASS, PULSE_CLASS);
    const cursor = overlay.querySelector<HTMLDivElement>(`.${CURSOR_CLASS}`);
    cursor?.classList.remove("is-visible", "is-pressed");
  }
  const timer = moveTimers.get(browserId);
  if (timer) {
    clearTimeout(timer);
    moveTimers.delete(browserId);
  }
  const pulse = pulseTimers.get(browserId);
  if (pulse) {
    clearTimeout(pulse);
    pulseTimers.delete(browserId);
  }
  cursorByBrowserId.delete(browserId);
}

function applyClick(browserId: string, x: number, y: number): void {
  applyActive(browserId);
  const overlay = findOverlay(browserId);
  if (!overlay) {
    return;
  }
  const cursor = ensureCursor(overlay);
  const ripple = ensureRipple(overlay);
  let state = cursorByBrowserId.get(browserId);
  if (!state) {
    const origin = defaultCursorOrigin(overlay);
    state = { x: origin.x, y: origin.y, visible: true, dragging: false };
    setCursorPosition(cursor, state.x, state.y, false);
  }
  cursor.classList.add("is-visible");
  cursor.classList.remove("is-pressed", "is-click-pop");
  overlay.classList.add(CLICKING_CLASS);

  const existing = moveTimers.get(browserId);
  if (existing) {
    clearTimeout(existing);
  }

  setCursorPosition(cursor, x, y, true);
  cursorByBrowserId.set(browserId, { x, y, visible: true, dragging: true });

  ripple.style.left = `${x}px`;
  ripple.style.top = `${y}px`;
  ripple.classList.remove("is-active");
  void ripple.offsetWidth;

  moveTimers.set(
    browserId,
    setTimeout(() => {
      moveTimers.delete(browserId);
      // Pop: enlarge then shrink when the click lands.
      cursor.classList.remove("is-click-pop");
      void cursor.offsetWidth;
      cursor.classList.add("is-click-pop");
      ripple.classList.add("is-active");
      overlay.classList.remove(CLICKING_CLASS);
      setTimeout(() => {
        cursor.classList.remove("is-click-pop");
        cursor.classList.add("is-pressed");
      }, 420);
    }, MOVE_MS),
  );
}

function applyMove(browserId: string, x: number, y: number, dragging: boolean): void {
  // Drag trails update often — skip breath pulse so the rim doesn't strobe.
  applyActive(browserId, { pulse: false });
  const overlay = findOverlay(browserId);
  if (!overlay) {
    return;
  }
  const cursor = ensureCursor(overlay);
  const state = cursorByBrowserId.get(browserId);
  if (!state) {
    setCursorPosition(cursor, x, y, false);
  } else {
    setCursorPosition(cursor, x, y, true, dragging ? DRAG_MOVE_MS : MOVE_MS);
  }
  cursor.classList.add("is-visible");
  if (dragging) {
    cursor.classList.add("is-pressed");
  }
  cursorByBrowserId.set(browserId, { x, y, visible: true, dragging });
}

function applyRelease(browserId: string, x: number, y: number): void {
  applyActive(browserId);
  const overlay = findOverlay(browserId);
  if (!overlay) {
    return;
  }
  const cursor = ensureCursor(overlay);
  const ripple = ensureRipple(overlay);
  setCursorPosition(cursor, x, y, true, DRAG_MOVE_MS);
  cursor.classList.add("is-visible");
  cursor.classList.remove("is-click-pop");
  cursor.classList.add("is-pressed");
  cursorByBrowserId.set(browserId, { x, y, visible: true, dragging: false });

  ripple.style.left = `${x}px`;
  ripple.style.top = `${y}px`;
  ripple.classList.remove("is-active");
  void ripple.offsetWidth;
  ripple.classList.add("is-active");

  const existing = moveTimers.get(browserId);
  if (existing) {
    clearTimeout(existing);
  }
  moveTimers.set(
    browserId,
    setTimeout(() => {
      moveTimers.delete(browserId);
      cursor.classList.remove("is-pressed");
      overlay.classList.remove(CLICKING_CLASS);
    }, 160),
  );
}

export function applyBrowserAgentPresenceEvent(event: BrowserAgentPresenceEvent): void {
  if (typeof document === "undefined") {
    return;
  }
  switch (event.type) {
    case "active":
      applyActive(event.browserId);
      return;
    case "click":
      applyClick(event.browserId, event.x, event.y);
      return;
    case "move":
      applyMove(event.browserId, event.x, event.y, event.dragging);
      return;
    case "release":
      applyRelease(event.browserId, event.x, event.y);
      return;
    case "idle":
      applyIdle(event.browserId);
      return;
  }
}

/** Start listening for Agent presence IPC (idempotent). */
export function installBrowserAgentPresenceOverlay(): () => void {
  if (typeof window === "undefined" || !window.eco?.onBrowserAgentPresence) {
    return () => {};
  }
  return window.eco.onBrowserAgentPresence((event) => {
    applyBrowserAgentPresenceEvent(event);
  });
}

/** Rainbow arrow pointer (hotspot ~1,1). */
const CURSOR_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 24 24" fill="none">
  <defs>
    <linearGradient id="browser-agent-cursor-grad" x1="2" y1="2" x2="18" y2="20" gradientUnits="userSpaceOnUse">
      <stop stop-color="#5ce1ff"/>
      <stop offset="0.28" stop-color="#8b6cff"/>
      <stop offset="0.55" stop-color="#ff5cc8"/>
      <stop offset="0.78" stop-color="#ffd15c"/>
      <stop offset="1" stop-color="#5cff9a"/>
    </linearGradient>
  </defs>
  <path d="M4.5 2.5 L4.5 18.2 L8.4 14.6 L11.6 21.4 L14.2 20.2 L11 13.4 L16.8 13.4 Z"
    fill="url(#browser-agent-cursor-grad)" stroke="rgba(255,255,255,0.75)" stroke-width="1.15" stroke-linejoin="round"/>
</svg>`;
