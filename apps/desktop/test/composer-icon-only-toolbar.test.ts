import assert from "node:assert/strict";
import test from "node:test";
import { resolveComposerIconOnlyToolbar } from "../src/renderer/ComposerHoverTooltip";

test("resolveComposerIconOnlyToolbar prefers Feed width over viewport", () => {
  assert.equal(
    resolveComposerIconOnlyToolbar({ feedWidth: 520, viewportMatches: false }),
    true,
  );
  assert.equal(
    resolveComposerIconOnlyToolbar({ feedWidth: 720, viewportMatches: true }),
    false,
  );
});

test("resolveComposerIconOnlyToolbar falls back to viewport when Feed is absent", () => {
  assert.equal(
    resolveComposerIconOnlyToolbar({ feedWidth: null, viewportMatches: true }),
    true,
  );
  assert.equal(
    resolveComposerIconOnlyToolbar({ feedWidth: undefined, viewportMatches: false }),
    false,
  );
  assert.equal(
    resolveComposerIconOnlyToolbar({ feedWidth: 0, viewportMatches: true }),
    true,
  );
});

test("resolveComposerIconOnlyToolbar treats 600px Feed as icon-only", () => {
  assert.equal(
    resolveComposerIconOnlyToolbar({ feedWidth: 600, viewportMatches: false }),
    true,
  );
  assert.equal(
    resolveComposerIconOnlyToolbar({ feedWidth: 601, viewportMatches: false }),
    false,
  );
});
