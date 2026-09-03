import assert from "node:assert/strict";
import test from "node:test";
import {
  findThinkingFeedScrollRoot,
  isThinkingPreferenceDrivenExpand,
  resolveThinkingCollapseHoldMs,
  resolveThinkingExpanded,
  resolveThinkingLayoutNotifyOptions,
  shouldEagerMountThinkingBody,
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

test("shouldEagerMountThinkingBody only for live or user-initiated open", () => {
  assert.equal(
    shouldEagerMountThinkingBody({
      activelyStreaming: true,
      settling: false,
      userExpanded: null,
    }),
    true,
  );
  assert.equal(
    shouldEagerMountThinkingBody({
      activelyStreaming: false,
      settling: true,
      userExpanded: null,
    }),
    true,
  );
  assert.equal(
    shouldEagerMountThinkingBody({
      activelyStreaming: false,
      settling: false,
      userExpanded: true,
    }),
    true,
  );
  assert.equal(
    shouldEagerMountThinkingBody({
      activelyStreaming: false,
      settling: false,
      userExpanded: null,
    }),
    false,
  );
  assert.equal(
    shouldEagerMountThinkingBody({
      activelyStreaming: false,
      settling: false,
      userExpanded: false,
    }),
    false,
  );
});

test("isThinkingPreferenceDrivenExpand is true only for default preference path", () => {
  assert.equal(
    isThinkingPreferenceDrivenExpand({
      activelyStreaming: false,
      settling: false,
      userExpanded: null,
    }),
    true,
  );
  assert.equal(
    isThinkingPreferenceDrivenExpand({
      activelyStreaming: true,
      settling: false,
      userExpanded: null,
    }),
    false,
  );
  assert.equal(
    isThinkingPreferenceDrivenExpand({
      activelyStreaming: false,
      settling: false,
      userExpanded: true,
    }),
    false,
  );
});

test("resolveThinkingLayoutNotifyOptions defers preference-driven expand flushes", () => {
  assert.equal(
    resolveThinkingLayoutNotifyOptions({
      displayOpen: true,
      preferenceDriven: true,
    }),
    undefined,
  );
  assert.deepEqual(
    resolveThinkingLayoutNotifyOptions({
      displayOpen: false,
      preferenceDriven: true,
    }),
    { immediate: true },
  );
  assert.deepEqual(
    resolveThinkingLayoutNotifyOptions({
      displayOpen: true,
      preferenceDriven: false,
    }),
    { immediate: true },
  );
});

test("findThinkingFeedScrollRoot walks up to activity-messages", () => {
  const scroll = { classList: { contains: () => false }, closest: (sel: string) => (sel === ".activity-messages" ? scroll : null) };
  const child = { closest: (sel: string) => (sel === ".activity-messages" ? scroll : null) };
  assert.equal(findThinkingFeedScrollRoot(child as unknown as Element), scroll);
  assert.equal(findThinkingFeedScrollRoot(null), null);
});
