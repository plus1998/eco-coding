import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveThinkingCollapseHoldMs,
  resolveThinkingExpanded,
  THINKING_COLLAPSE_ANIM_MS,
  THINKING_COLLAPSE_HOLD_MS,
} from "../src/renderer/thinking-block-expand";

test("resolveThinkingExpanded opens while streaming, settling, or manual", () => {
  assert.equal(
    resolveThinkingExpanded({
      activelyStreaming: true,
      settling: false,
      manualExpanded: false,
    }),
    true,
  );
  assert.equal(
    resolveThinkingExpanded({
      activelyStreaming: false,
      settling: true,
      manualExpanded: false,
    }),
    true,
  );
  assert.equal(
    resolveThinkingExpanded({
      activelyStreaming: false,
      settling: false,
      manualExpanded: true,
    }),
    true,
  );
  assert.equal(
    resolveThinkingExpanded({
      activelyStreaming: false,
      settling: false,
      manualExpanded: false,
    }),
    false,
  );
});

test("resolveThinkingCollapseHoldMs returns 0 hold (collapse immediately on end)", () => {
  assert.equal(resolveThinkingCollapseHoldMs(false), THINKING_COLLAPSE_HOLD_MS);
  assert.equal(resolveThinkingCollapseHoldMs(true), 0);
  assert.equal(THINKING_COLLAPSE_HOLD_MS, 0);
  assert.ok(THINKING_COLLAPSE_ANIM_MS > 0);
});
