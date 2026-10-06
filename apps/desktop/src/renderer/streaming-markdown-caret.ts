import { Plugin, PluginKey } from "prosemirror-state";
import type { Node as PMNode } from "prosemirror-model";
import type { EditorView } from "prosemirror-view";
import { Decoration, DecorationSet } from "prosemirror-view";

/**
 * Live caret for a streaming Markdown response.
 *
 * A finely stepped reveal already reads as typing, but the caret is what makes
 * "still generating" legible at a glance — and it gives large reveals (tool
 * output, a burst of tokens) something to land on instead of appearing as a
 * silent block of new text.
 *
 * It is a ProseMirror widget decoration rather than a pseudo-element so it sits
 * at the true end of the content — inline after the last word of a paragraph, or
 * inside a code block — instead of below the last block. The widget carries a
 * stable `key`, which is how ProseMirror decides to reuse the same DOM node
 * across updates; that keeps the CSS keyframes running continuously instead of
 * restarting on every tick.
 */
export interface StreamingCaretController {
  /** Plugin to append to the feed Markdown plugin list. */
  plugin: Plugin;
  /** Editor the caret belongs to; the controller drives visibility through it. */
  attachView(view: EditorView | null): void;
  /** Show or hide the caret. */
  setVisible(visible: boolean): void;
  /** Momentary highlight when a larger chunk of text lands. */
  pulse(): void;
}

/** Minimum reveal, in code units, that is worth a pulse. */
export const STREAM_CARET_PULSE_MIN_UNITS = 2;
/** Pulses are rate limited so a fast stream does not strobe. */
export const STREAM_CARET_PULSE_MIN_INTERVAL_MS = 120;

const caretKey = new PluginKey<boolean>("ecoStreamCaret");
const caretMeta = "ecoStreamCaretVisible";
const caretWidgetKey = "eco-stream-caret";

/**
 * Position at the true end of the response.
 *
 * `doc.content.size` places the widget *between* top-level blocks, and an empty
 * inline box still opens a line in a block container: the caret would end up
 * below the last paragraph and add height to the message. Descending into the
 * deepest text block keeps it inline at the end of the last line instead.
 */
export function streamCaretPosition(doc: PMNode): number {
  let node: PMNode = doc;
  // Position of `node` as `descendants` reports it; the doc itself sits before 0.
  let nodePos = -1;
  for (;;) {
    if (node.isTextblock) {
      // Content starts at nodePos + 1, so this is the position after its last child.
      return nodePos + 1 + node.content.size;
    }
    if (node.isLeaf) {
      return nodePos + node.nodeSize;
    }
    const last = node.lastChild;
    if (!last || !last.isBlock) {
      // Empty container, or one ending in inline content: stay inside it.
      return nodePos + 1 + node.content.size;
    }
    nodePos = nodePos + 1 + (node.content.size - last.nodeSize);
    node = last;
  }
}

export function createStreamingCaretController(): StreamingCaretController {
  let element: HTMLElement | null = null;
  let view: EditorView | null = null;
  let lastPulseAt = 0;
  let visible = false;

  const plugin = new Plugin<boolean>({
    key: caretKey,
    state: {
      // The feed host rebuilds the whole EditorState whenever the response
      // changes, which re-runs `init` — so the flag has to live outside the
      // state, and the state is only a projection of it. `setVisible` still
      // dispatches, because hiding the caret when nothing else changes (the end
      // of a turn) has no state rebuild to piggyback on.
      init: () => visible,
      apply: (tr, value) => tr.getMeta(caretMeta) ?? value,
    },
    props: {
      decorations(state) {
        if (!caretKey.getState(state)) {
          return null;
        }
        return DecorationSet.create(state.doc, [
          Decoration.widget(
            streamCaretPosition(state.doc),
            () => {
              const mounted = document.createElement("span");
              mounted.className = "stream-caret";
              mounted.setAttribute("aria-hidden", "true");
              element = mounted;
              return mounted;
            },
            {
              side: 1,
              key: caretWidgetKey,
              ignoreSelection: true,
              destroy: () => {
                element = null;
              },
            },
          ),
        ]);
      },
    },
  });

  return {
    plugin,
    attachView(next) {
      view = next;
      if (!next) {
        element = null;
      }
    },
    setVisible(next) {
      const changed = visible !== next;
      visible = next;
      // No view yet: the decoration reads the flag when the editor is created.
      if (changed && view) {
        view.dispatch(view.state.tr.setMeta(caretMeta, next));
      }
    },
    pulse() {
      const target = element;
      if (!target || typeof target.animate !== "function") {
        return;
      }
      if (prefersReducedMotion()) {
        return;
      }
      const now = Date.now();
      if (now - lastPulseAt < STREAM_CARET_PULSE_MIN_INTERVAL_MS) {
        return;
      }
      lastPulseAt = now;
      // Modulates the parent of the bar, so it composes with the breathing
      // animation instead of fighting it.
      target.animate(
        [
          { opacity: 0.35, transform: "scaleY(0.6)" },
          { opacity: 1, transform: "scaleY(1)" },
        ],
        { duration: 220, easing: "ease-out" },
      );
    },
  };
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
}
