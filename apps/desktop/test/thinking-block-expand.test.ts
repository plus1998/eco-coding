import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveThinkingCollapseHoldMs,
  resolveThinkingExpanded,
  THINKING_COLLAPSE_ANIM_MS,
  THINKING_COLLAPSE_HOLD_MS,
} from "../src/renderer/thinking-block-expand";

test("resolveThinkingExpanded opens while streaming, settling, or user-expanded", () => {
  assert.equal(
    resolveThinkingExpanded({
      activelyStreaming: true,
      settling: false,
      userExpanded: null,
      defaultExpanded: false,
    }),
    true,
  );
  assert.equal(
    resolveThinkingExpanded({
      activelyStreaming: false,
      settling: true,
      userExpanded: null,
      defaultExpanded: false,
    }),
    true,
  );
  assert.equal(
    resolveThinkingExpanded({
      activelyStreaming: false,
      settling: false,
      userExpanded: true,
      defaultExpanded: false,
    }),
    true,
  );
  assert.equal(
    resolveThinkingExpanded({
      activelyStreaming: false,
      settling: false,
      userExpanded: null,
      defaultExpanded: false,
    }),
    false,
  );
});

test("resolveThinkingExpanded follows defaultExpanded when user has not overridden", () => {
  assert.equal(
    resolveThinkingExpanded({
      activelyStreaming: false,
      settling: false,
      userExpanded: null,
      defaultExpanded: true,
    }),
    true,
  );
  assert.equal(
    resolveThinkingExpanded({
      activelyStreaming: false,
      settling: false,
      userExpanded: false,
      defaultExpanded: true,
    }),
    false,
  );
  assert.equal(
    resolveThinkingExpanded({
      activelyStreaming: false,
      settling: false,
      userExpanded: true,
      defaultExpanded: false,
    }),
    true,
  );
});

test("resolveThinkingCollapseHoldMs returns 0 hold (collapse immediately on end)", () => {
  assert.equal(resolveThinkingCollapseHoldMs(false), THINKING_COLLAPSE_HOLD_MS);
  assert.equal(resolveThinkingCollapseHoldMs(true), 0);
  assert.equal(THINKING_COLLAPSE_HOLD_MS, 0);
  assert.ok(THINKING_COLLAPSE_ANIM_MS > 0);
});
