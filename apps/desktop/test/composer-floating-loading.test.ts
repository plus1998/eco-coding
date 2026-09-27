import { afterEach, beforeEach, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ComposerFloatingLoading } from "../src/renderer/ComposerFloatingLoading";
import {
  advanceComposerAgentSilenceClock,
  COMPOSER_FLOATING_LOADING_DELAY_MS,
  type ComposerAgentSilenceClock,
  isComposerAgentSilent,
  resolveComposerAgentSilenceDelayMs,
} from "../src/renderer/composer-floating-loading";
import { i18n } from "../src/renderer/i18n";

let previousLanguage = "zh-CN";

beforeEach(async () => {
  previousLanguage = i18n.resolvedLanguage ?? i18n.language;
  await i18n.changeLanguage("zh-CN");
});

afterEach(async () => {
  await i18n.changeLanguage(previousLanguage);
});

test("advanceComposerAgentSilenceClock keeps the clock while the feed holds still", () => {
  const started = advanceComposerAgentSilenceClock(undefined, "row:12", 1_000);

  expect(started).toEqual({ signature: "row:12", movedAtMs: 1_000 });
  // Same object, so a render that changed nothing does not restart the wait.
  expect(advanceComposerAgentSilenceClock(started, "row:12", 1_400)).toBe(started);
});

test("advanceComposerAgentSilenceClock restarts when the feed moves", () => {
  const started = advanceComposerAgentSilenceClock(undefined, "row:12", 1_000);
  const moved = advanceComposerAgentSilenceClock(started, "row:27", 1_400);

  expect(moved).toEqual({ signature: "row:27", movedAtMs: 1_400 });
});

test("isComposerAgentSilent needs a live run the feed is not already narrating", () => {
  const clock = advanceComposerAgentSilenceClock(undefined, "row:12", 1_000);

  expect(isComposerAgentSilent({ active: true, feedIndicatorVisible: false, clock, nowMs: 9_000 })).toBe(
    true,
  );
  // The run is over: nothing is being waited on.
  expect(isComposerAgentSilent({ active: false, feedIndicatorVisible: false, clock, nowMs: 9_000 })).toBe(
    false,
  );
  // The feed's own waiting line owns the tail; the two never share the screen.
  expect(isComposerAgentSilent({ active: true, feedIndicatorVisible: true, clock, nowMs: 9_000 })).toBe(
    false,
  );
  // No clock yet means nothing has been rendered to measure.
  expect(
    isComposerAgentSilent({ active: true, feedIndicatorVisible: false, clock: undefined, nowMs: 9_000 }),
  ).toBe(false);
});

test("isComposerAgentSilent waits out the delay before admitting the stall", () => {
  const clock = advanceComposerAgentSilenceClock(undefined, "row:12", 1_000);
  const at = (nowMs: number) =>
    isComposerAgentSilent({ active: true, feedIndicatorVisible: false, clock, nowMs });

  expect(at(1_000 + COMPOSER_FLOATING_LOADING_DELAY_MS - 1)).toBe(false);
  expect(at(1_000 + COMPOSER_FLOATING_LOADING_DELAY_MS)).toBe(true);
});

test("resolveComposerAgentSilenceDelayMs counts down to the flip and stops there", () => {
  const clock: ComposerAgentSilenceClock = { signature: "row:12", movedAtMs: 1_000 };

  expect(resolveComposerAgentSilenceDelayMs(clock, 1_000)).toBe(COMPOSER_FLOATING_LOADING_DELAY_MS);
  expect(resolveComposerAgentSilenceDelayMs(clock, 1_300)).toBe(COMPOSER_FLOATING_LOADING_DELAY_MS - 300);
  expect(resolveComposerAgentSilenceDelayMs(clock, 1_000 + COMPOSER_FLOATING_LOADING_DELAY_MS)).toBe(0);
  // Already past the delay: fire now rather than never.
  expect(resolveComposerAgentSilenceDelayMs(clock, 9_000)).toBe(0);
});

test("the dots stay off while the agent narrates and come up once it goes quiet for the tool call", () => {
  // The scenario the indicator exists for: the agent says "让我读取代码：" and then spends a
  // while writing the tool call's arguments, which the Feed drops until `input_complete`.
  // Every token of that sentence changes the signature; the JSON that follows changes nothing.
  let clock: ComposerAgentSilenceClock | undefined;
  const visible = (signature: string, nowMs: number, active = true) => {
    clock = advanceComposerAgentSilenceClock(clock, signature, nowMs);
    return isComposerAgentSilent({ active, feedIndicatorVisible: false, clock, nowMs });
  };

  expect(visible("prompt", 0)).toBe(false);
  expect(visible("narrative:3", 60)).toBe(false);
  expect(visible("narrative:8", 120)).toBe(false);
  expect(visible("narrative:14", 180)).toBe(false);
  // Last text token, then the tool call starts being written. Nothing moves from here.
  expect(visible("narrative:19", 240)).toBe(false);
  expect(visible("narrative:19", 600)).toBe(false);
  expect(visible("narrative:19", 740)).toBe(true);
  // The tool card lands: the feed is moving again.
  expect(visible("narrative:19|tool-group:1", 900)).toBe(false);
  // And it is silent once more between two tool calls.
  expect(visible("narrative:19|tool-group:1", 1_600)).toBe(true);
});

test("a settled thread never keeps the dots up", () => {
  const clock = advanceComposerAgentSilenceClock(undefined, "row:12", 1_000);

  expect(isComposerAgentSilent({ active: false, feedIndicatorVisible: false, clock, nowMs: 60_000 })).toBe(
    false,
  );
});

test("ComposerFloatingLoading renders the feed's loading mark with a working label", () => {
  const html = renderToStaticMarkup(createElement(ComposerFloatingLoading));

  expect(html).toContain('class="composer-floating-loading"');
  expect(html).toContain('role="status"');
  expect(html).toContain('aria-label="工作中"');
  // The same three-dot mark the Feed's own loading state draws, not a second text label:
  // the Feed already owns「正在思考」and this must not read as a duplicate of it.
  expect(html.match(/<span><\/span>/g)?.length).toBe(3);
  expect(html).not.toContain("正在思考");
});
