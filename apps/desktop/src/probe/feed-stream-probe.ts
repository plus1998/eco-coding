/**
 * Streaming feed render-cost probe.
 *
 * Runs in real Chromium against the app's own markdown/ProseMirror pipeline so
 * the numbers reflect the production path (PacedReveal -> incremental doc ->
 * DOM update -> layout), not a synthetic approximation.
 *
 * Open `/feed-probe.html` in the dev renderer and call
 * `window.__PROBE__.run("<mode>")`:
 *
 *   cadence                      pacing math over smooth / bursty arrivals
 *   micro                        parse / ProseMirror / layout cost by length
 *   doc                          incremental doc build cost per reveal tick
 *   stack:<cps>:<seconds>        full StreamingMarkdownContent frame trace
 *   alt                          counterfactual: frozen blocks + tail text node
 *   baseline                     plain MarkdownContent re-render cost
 */
import { EditorState, Plugin } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { MarkdownContent } from "../renderer/MarkdownContent";
import { StreamingMarkdownContent } from "../renderer/StreamingMarkdownContent";
import {
  createFeedMarkdownDoc,
  feedMarkdownSchema,
  FEED_MARKDOWN_PLUGINS,
} from "../renderer/prosemirror/feed-markdown";
import { createStreamingCaretController } from "../renderer/streaming-markdown-caret";
import {
  buildStreamingMarkdownDoc,
  createStreamingMarkdownDocCache,
} from "../renderer/streaming-markdown-doc";
import { partitionStreamingMarkdown } from "../renderer/streaming-markdown-partition";
import {
  resolveStreamReveal,
  resolveStreamTickMs,
  takeStreamUnits,
  updateArrivalRate,
  estimateArrivalRate,
  type ArrivalSample,
} from "../renderer/use-paced-stream-text";
import "../renderer/styles.css";
import { createElement, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

const PARAGRAPH = `Feed 渲染管线的核心问题是每一次 reveal tick 都会把整段回复重新解析一遍。Markdown 解析本身是线性的，但 tick 的频率乘以累计长度，整体就退化成二次复杂度。下面用一次典型的 agent 回复做测量。`;

function buildResponse(targetChars: number): string {
  const parts: string[] = ["# 分析结论\n"];
  let size = parts[0]!.length;
  let index = 0;
  while (size < targetChars) {
    index += 1;
    if (index % 7 === 0) {
      const block = `\n\`\`\`ts\nfunction step${index}(input: string) {\n  return input.trim();\n}\n\`\`\`\n`;
      parts.push(block);
      size += block.length;
      continue;
    }
    if (index % 5 === 0) {
      const block = `\n| 指标 | 数值 | 说明 |\n| --- | --- | --- |\n| tick | 16ms | 每帧 |\n| parse | O(n) | 增量重建 |\n`;
      parts.push(block);
      size += block.length;
      continue;
    }
    const block = `\n## 小节 ${index}\n\n${PARAGRAPH}\n\n- 要点 A${index}\n- 要点 B${index}\n`;
    parts.push(block);
    size += block.length;
  }
  return parts.join("");
}

const WALL = "这是一段没有空行的长段落，用来模拟最坏的流式形态：整段内容始终处于未封口活区。";

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx]!;
}

const now = () => performance.now();

/* ------------------------------------------------------------------ *
 * 1. 节奏仿真：用应用导出的真实 pacer 数学，不涉及 DOM
 * ------------------------------------------------------------------ */

interface CadenceRow {
  label: string;
  medianStep: number;
  p90Step: number;
  maxStep: number;
  medianLagMs: number;
  finalLagMs: number;
}

function simulateCadence(input: {
  label: string;
  charsPerSecond: number;
  seconds: number;
  burstEveryMs?: number;
}): CadenceRow {
  const dtMs = 16;
  const total = Math.round(input.charsPerSecond * input.seconds);
  const plain = WALL.repeat(Math.ceil(total / WALL.length)).slice(0, total);
  const samples: ArrivalSample[] = [];
  let arrived = 0;
  let burstCredit = 0;
  let display = 0;
  let carry = 0;
  let rate = 0;
  let lastTick = 0;
  const steps: number[] = [];
  const lags: number[] = [];
  for (let at = dtMs; at <= (input.seconds + 5) * 1000; at += dtMs) {
    if (input.burstEveryMs) {
      // Burst boundaries must not depend on the tick grid: 16 ms ticks only
      // land on multiples of 200 ms every 400 ms, which would halve the rate.
      const phase = Math.floor(at / input.burstEveryMs);
      const previousPhase = Math.floor((at - dtMs) / input.burstEveryMs);
      if (phase !== previousPhase) {
        const add = (input.charsPerSecond * input.burstEveryMs) / 1000;
        arrived = Math.min(plain.length, arrived + Math.round(add + burstCredit));
        burstCredit = add - Math.round(add);
      }
    } else {
      arrived = Math.min(plain.length, Math.round((at / 1000) * input.charsPerSecond));
    }
    if (arrived > 0) {
      // Mirrors the hook: a sample per received delta, not per frame. Sampling
      // the flat gaps between bursts would measure the arrival rate as zero.
      const last = samples[samples.length - 1];
      if (!last || last.chars !== arrived) {
        samples.push({ at, chars: arrived });
      }
      while (samples.length > 2 && samples[0]!.at < at - 900) samples.shift();
      const measured = estimateArrivalRate(samples);
      if (measured !== null) rate = updateArrivalRate(rate, measured);
    }
    if (at < lastTick + dtMs) {
      continue;
    }
    const pending = arrived - display;
    if (pending > 0) {
      const step = resolveStreamReveal({ pending, rate, dtMs, carry });
      carry = step.carry;
      const advanced = takeStreamUnits(plain, display, step.take);
      if (advanced > 0) {
        display += advanced;
        steps.push(advanced);
      }
      lags.push(((arrived - display) / Math.max(24, rate)) * 1000);
    }
    lastTick = at;
  }
  const tail = lags.slice(Math.floor(lags.length / 2));
  return {
    label: input.label,
    medianStep: median(steps),
    p90Step: percentile(steps, 90),
    maxStep: Math.max(...steps, 0),
    medianLagMs: median(tail),
    finalLagMs: tail[tail.length - 1] ?? 0,
  };
}

/* ------------------------------------------------------------------ *
 * 2. DOM 微分解：真 Chromium 里的解析 / PM 重建 / 布局成本
 * ------------------------------------------------------------------ */

function makeScroller(): { scroller: HTMLElement; host: HTMLElement } {
  const scroller = document.createElement("div");
  scroller.style.cssText =
    "position:absolute;left:-10000px;top:0;width:720px;height:620px;overflow-y:auto;";
  scroller.className = "activity-messages";
  const host = document.createElement("div");
  host.className = "run-log-feed-entry";
  scroller.appendChild(host);
  document.body.appendChild(scroller);
  return { scroller, host };
}

function mountPmHost(parent: HTMLElement): EditorView {
  const state = EditorState.create({
    schema: feedMarkdownSchema,
    doc: createFeedMarkdownDoc(""),
    plugins: [
      ...FEED_MARKDOWN_PLUGINS,
      new Plugin({ props: { editable: () => false, attributes: { class: "pm-editor-content" } } }),
    ],
  });
  return new EditorView(parent, { state });
}

function runMicro() {
  const rows: Array<Record<string, number>> = [];
  const { scroller, host } = makeScroller();
  const view = mountPmHost(host);
  for (const size of [2_000, 5_000, 10_000, 20_000, 40_000, 80_000]) {
    // End mid-block (no trailing newline) so the mutable tail is non-empty,
    // which is the real shape of an in-flight streaming response.
    const text = `${buildResponse(size)}正在继续输出这一段还没有结束的说明`;
    const partition: number[] = [];
    const parse: number[] = [];
    const pm: number[] = [];
    const layout: number[] = [];
    const doc: number[] = [];
    for (let i = 0; i < 7; i += 1) {
      let t = now();
      const { stable, tail } = partitionStreamingMarkdown(text, true);
      partition.push(now() - t);

      t = now();
      const fullDoc = createFeedMarkdownDoc(text);
      parse.push(now() - t);

      t = now();
      view.updateState(
        EditorState.create({ schema: view.state.schema, doc: fullDoc, plugins: view.state.plugins }),
      );
      pm.push(now() - t);

      t = now();
      void scroller.scrollHeight;
      void host.getBoundingClientRect().height;
      layout.push(now() - t);

      // The production path: one cache per response, sealed blocks reused.
      const cache = createStreamingMarkdownDocCache();
      t = now();
      buildStreamingMarkdownDoc(cache, stable, tail);
      doc.push(now() - t);
    }
    rows.push({
      chars: text.length,
      partitionMs: median(partition),
      fullParseMs: median(parse),
      pmUpdateMs: median(pm),
      layoutMs: median(layout),
      incrementalDocMs: median(doc),
      tickMs: resolveStreamTickMs(median(doc)),
    });
  }
  view.destroy();
  scroller.remove();
  return rows;
}

/**
 * Incremental build during a real stream: cost must not grow with the length of
 * the response already committed.
 */
function runDoc() {
  const rows: Array<Record<string, number | string>> = [];
  for (const size of [5_000, 20_000, 40_000, 80_000]) {
    for (const [layout, text] of [
      ["structured", buildResponse(size)],
      ["one-paragraph", WALL.repeat(Math.ceil(size / WALL.length)).slice(0, size)],
    ] as const) {
      const stream = `${text}正在继续输出这一段还没有结束的说明`;
      const cache = createStreamingMarkdownDocCache();
      const revealTicks: number[] = [];
      const commitTicks: number[] = [];
      for (let end = 0; end <= stream.length; end += 4) {
        const prefix = stream.slice(0, end);
        const { stable, tail } = partitionStreamingMarkdown(prefix, true);
        const committedChanged = stable !== cache.settledScanText;
        const t = now();
        buildStreamingMarkdownDoc(cache, stable, tail);
        const cost = now() - t;
        (committedChanged ? commitTicks : revealTicks).push(cost);
      }
      rows.push({
        chars: stream.length,
        layout,
        sealedChars: cache.sealedText.length,
        revealTicks: revealTicks.length,
        revealMedMs: Number(median(revealTicks).toFixed(3)),
        revealP95Ms: Number(percentile(revealTicks, 95).toFixed(3)),
        commitTicks: commitTicks.length,
        commitMedMs: Number(median(commitTicks).toFixed(3)),
        commitP95Ms: Number(percentile(commitTicks, 95).toFixed(3)),
      });
    }
  }
  return rows;
}

/* ------------------------------------------------------------------ *
 * 3. 全栈：真实 StreamingMarkdownContent，测帧与长任务
 * ------------------------------------------------------------------ */

interface StackResult {
  charsPerSecond: number;
  totalChars: number;
  seconds: number;
  frames: number;
  frameP50: number;
  frameP95: number;
  frameP99: number;
  droppedFrames: number;
  worstFrameMs: number;
  worstAfterWarmupMs: number;
  worstFrames: Array<[number, number]>;
  longTasks: number;
  longTaskMaxMs: number;
  totalBlockingMs: number;
  revealSteps: number[];
  revealedTimeline: Array<[number, number]>;
}

function StackHarness({
  charsPerSecond,
  seconds,
  onDone,
}: {
  charsPerSecond: number;
  seconds: number;
  onDone: (result: StackResult) => void;
}) {
  const [text, setText] = useState("");
  const [streaming, setStreaming] = useState(true);
  const full = useRef(buildResponse(charsPerSecond * seconds));
  const observed = useRef<Array<[number, number]>>([]);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const startedAt = now();
    const frameDurations: Array<[number, number]> = [];
    const longTasks: number[] = [];
    let lastFrame = now();
    let lastObservedLen = -1;
    let frameHandle = 0;
    const sampleFrame = () => {
      const at = now();
      frameDurations.push([Math.round(at - startedAt), at - lastFrame]);
      lastFrame = at;
      const node = rootRef.current?.querySelector(".markdown-content, .markdown-content--streaming-body");
      const len = node ? (node.textContent ?? "").length : 0;
      if (len !== lastObservedLen) {
        lastObservedLen = len;
        observed.current.push([Math.round(at - startedAt), len]);
      }
      frameHandle = window.requestAnimationFrame(sampleFrame);
    };
    frameHandle = window.requestAnimationFrame(sampleFrame);

    const observer =
      typeof PerformanceObserver !== "undefined" &&
      PerformanceObserver.supportedEntryTypes?.includes("longtask")
        ? new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) longTasks.push(entry.duration);
          })
        : null;
    observer?.observe({ entryTypes: ["longtask"] });

    const arriveTimer = window.setInterval(() => {
      const elapsed = (now() - startedAt) / 1000;
      const len = Math.min(full.current.length, Math.floor(elapsed * charsPerSecond));
      setText(full.current.slice(0, len));
      if (elapsed >= seconds) {
        window.clearInterval(arriveTimer);
        setStreaming(false);
        window.setTimeout(() => {
          window.cancelAnimationFrame(frameHandle);
          observer?.disconnect();
          const durations = frameDurations.map((entry) => entry[1]);
          const warm = frameDurations.filter((entry) => entry[0] > 600).map((entry) => entry[1]);
          const timeline = observed.current;
          const steps: number[] = [];
          for (let index = 1; index < timeline.length; index += 1) {
            steps.push(timeline[index]![1] - timeline[index - 1]![1]);
          }
          onDone({
            charsPerSecond,
            totalChars: full.current.length,
            seconds,
            frames: durations.length,
            frameP50: Number(median(durations).toFixed(1)),
            frameP95: Number(percentile(durations, 95).toFixed(1)),
            frameP99: Number(percentile(durations, 99).toFixed(1)),
            droppedFrames: durations.filter((value) => value > 25).length,
            worstFrameMs: Number(Math.max(...durations, 0).toFixed(1)),
            worstAfterWarmupMs: Number(Math.max(...warm, 0).toFixed(1)),
            worstFrames: [...frameDurations]
              .sort((a, b) => b[1] - a[1])
              .slice(0, 8)
              .map((entry) => [entry[0], Number(entry[1].toFixed(1))] as [number, number]),
            longTasks: longTasks.length,
            longTaskMaxMs: Number(Math.max(...longTasks, 0).toFixed(1)),
            totalBlockingMs: Number(longTasks.reduce((sum, value) => sum + value, 0).toFixed(1)),
            revealSteps: steps,
            revealedTimeline: timeline.slice(0, 200),
          });
        }, 400);
      }
    }, 16);

    return () => {
      window.clearInterval(arriveTimer);
      window.cancelAnimationFrame(frameHandle);
      observer?.disconnect();
    };
  }, [charsPerSecond, seconds, onDone]);

  return createElement(
    "div",
    { ref: rootRef, className: "run-log-feed-entry", style: { width: "720px" } },
    createElement(StreamingMarkdownContent, { text, streaming, className: "markdown-content" }),
  );
}

function runStack(charsPerSecond: number, seconds: number): Promise<StackResult> {
  return new Promise((resolve) => {
    const container = document.createElement("div");
    container.style.cssText = "position:absolute;left:-10000px;top:0;width:720px;";
    document.body.appendChild(container);
    const root = createRoot(container);
    root.render(
      createElement(StackHarness, {
        charsPerSecond,
        seconds,
        onDone: (result) => {
          root.unmount();
          container.remove();
          resolve(result);
        },
      }),
    );
  });
}

/* ------------------------------------------------------------------ *
 * 3b. 可见的实时 demo：用于人工/截图检查光标、间距与重挂载
 * ------------------------------------------------------------------ */

/**
 * Mounts a real streaming response in a visible box and returns immediately, so
 * the DOM can be inspected (and screenshotted) while it streams. Stop it with
 * `window.__PROBE_DEMO__.stop()`.
 */
function runDemo(charsPerSecond: number, seconds: number): { mounted: boolean } {
  const container = document.createElement("div");
  container.id = "probe-demo";
  container.style.cssText = "position:fixed;inset:0;z-index:9999;background:#171717;padding:24px;overflow:auto;";
  document.body.appendChild(container);
  const root = createRoot(container);
  const stopTimer = window.setTimeout(() => {}, 0);
  window.clearTimeout(stopTimer);
  let stop = () => {};
  root.render(
    createElement(DemoHarness, {
      charsPerSecond,
      seconds,
      registerStop: (next) => {
        stop = next;
      },
    }),
  );
  window.__PROBE_DEMO__ = {
    stop: () => {
      stop();
      root.unmount();
      container.remove();
      delete window.__PROBE_DEMO__;
    },
  };
  return { mounted: true };
}

function DemoHarness({
  charsPerSecond,
  seconds,
  registerStop,
}: {
  charsPerSecond: number;
  seconds: number;
  registerStop: (stop: () => void) => void;
}) {
  const [text, setText] = useState("");
  const [streaming, setStreaming] = useState(true);
  const full = useRef(buildResponse(charsPerSecond * seconds));

  useEffect(() => {
    const startedAt = now();
    const timer = window.setInterval(() => {
      const elapsed = (now() - startedAt) / 1000;
      setText(full.current.slice(0, Math.min(full.current.length, Math.floor(elapsed * charsPerSecond))));
      if (elapsed >= seconds) {
        window.clearInterval(timer);
        setStreaming(false);
      }
    }, 16);
    registerStop(() => window.clearInterval(timer));
    return () => window.clearInterval(timer);
  }, [charsPerSecond, seconds, registerStop]);

  return createElement(
    "div",
    { style: { width: "720px" } },
    createElement(StreamingMarkdownContent, { text, streaming, className: "markdown-content" }),
  );
}

/* ------------------------------------------------------------------ *
 * 4. 反事实架构：已提交块挂载后不再重解析，只改尾块 text node
 * ------------------------------------------------------------------ */

function runAlt() {
  const rows: Array<Record<string, number>> = [];
  const { scroller, host } = makeScroller();
  for (const size of [5_000, 20_000, 80_000]) {
    const full = `${buildResponse(size)}正在继续输出这一段还没有结束的说明`;
    const { stable, tail } = partitionStreamingMarkdown(full, true);
    const blocks = stable.split(/\n(?=\S)/).filter((block) => block.trim().length > 0);
    const tailHost = document.createElement("div");
    tailHost.className = "markdown-content markdown-content--streaming-plain";
    tailHost.textContent = tail;

    const blockRoots = blocks.map((block) => {
      const el = document.createElement("div");
      const blockRoot = createRoot(el);
      blockRoot.render(createElement(MarkdownContent, { text: block }));
      return { el, blockRoot };
    });
    const wrapper = document.createElement("div");
    wrapper.className = "run-log-feed-entry";
    for (const { el } of blockRoots) wrapper.appendChild(el);
    wrapper.appendChild(tailHost);
    host.appendChild(wrapper);

    const tick: number[] = [];
    const layout: number[] = [];
    for (let i = 0; i < 40; i += 1) {
      let t = now();
      tailHost.textContent = `${tail}追加内容${"x".repeat(i)}`;
      tick.push(now() - t);
      t = now();
      void scroller.scrollHeight;
      layout.push(now() - t);
    }
    rows.push({
      chars: full.length,
      blocks: blocks.length,
      tailChars: tail.length,
      tailTickMs: median(tick),
      layoutMs: median(layout),
    });
    for (const { blockRoot } of blockRoots) blockRoot.unmount();
    host.replaceChildren();
  }
  scroller.remove();
  return rows;
}

/* ------------------------------------------------------------------ *
 * 5. 光标装饰：确认 setVisible 真的能挂上/移除 widget
 * ------------------------------------------------------------------ */

async function runCaret(): Promise<Record<string, unknown>> {
  const controller = createStreamingCaretController();
  const host = document.createElement("div");
  host.className = "markdown-content";
  host.style.cssText = "position:absolute;left:-10000px;top:0;width:720px;";
  document.body.appendChild(host);
  const state = EditorState.create({
    schema: feedMarkdownSchema,
    doc: createFeedMarkdownDoc("一段正在流式输出的正文"),
    plugins: [
      ...FEED_MARKDOWN_PLUGINS,
      controller.plugin,
      new Plugin({ props: { editable: () => false, attributes: { class: "pm-editor-content" } } }),
    ],
  });
  const view = new EditorView(host, {
    state,
    dispatchTransaction: (tr) => view.updateState(view.state.apply(tr)),
  });
  controller.attachView(view);

  const afterCreate = document.querySelectorAll(".stream-caret").length;
  const view1 = view.dom;
  host.querySelector(".ProseMirror")?.setAttribute("data-probe-view", "1");
  controller.setVisible(true);
  const afterShow = document.querySelectorAll(".stream-caret").length;
  const caret = host.querySelector(".stream-caret");
  const caretStyle = caret ? getComputedStyle(caret, "::after") : null;
  // A doc change on the next tick must keep the same widget DOM node.
  view.updateState(
    EditorState.create({
      schema: view.state.schema,
      doc: createFeedMarkdownDoc("一段正在流式输出的正文，又多了几个字"),
      plugins: view.state.plugins,
    }),
  );
  const afterDocUpdate = document.querySelectorAll(".stream-caret").length;
  const sameNode = document.querySelector(".stream-caret") === caret;
  // Does the caret change the line box it sits in? It must not: a caret that
  // grows its line makes the message jump when it disappears at settle.
  const withCaret = {
    hostHeight: host.getBoundingClientRect().height,
    lastLineHeight: host.querySelector("p")?.getBoundingClientRect().height ?? 0,
    caretBoxHeight: caret?.getBoundingClientRect().height ?? 0,
  };
  controller.setVisible(false);
  const withoutCaret = {
    hostHeight: host.getBoundingClientRect().height,
    lastLineHeight: host.querySelector("p")?.getBoundingClientRect().height ?? 0,
  };
  controller.setVisible(true);
  const withCaretAgain = host.getBoundingClientRect().height;
  controller.pulse();
  controller.setVisible(false);
  const afterHide = document.querySelectorAll(".stream-caret").length;
  const sameViewDom = view1 === view.dom && host.querySelector('[data-probe-view="1"]') !== null;
  view.destroy();
  host.remove();
  return {
    afterCreate,
    afterShow,
    caretParent: caret?.parentElement?.tagName,
    caretAfterPrev: caret?.previousSibling?.textContent,
    caretBarWidth: caretStyle?.width,
    caretBarBackground: caretStyle?.backgroundColor,
    caretBarAnimation: caretStyle?.animationName,
    afterDocUpdate,
    sameNode,
    afterHide,
    sameViewDom,
    withCaret,
    withoutCaret,
    withCaretAgain,
  };
}

/* ------------------------------------------------------------------ *
 * 入口
 * ------------------------------------------------------------------ */

async function run(which: string): Promise<unknown> {
  if (which === "cadence") {
    return [
      simulateCadence({ label: "40 cps", charsPerSecond: 40, seconds: 120 }),
      simulateCadence({ label: "200 cps", charsPerSecond: 200, seconds: 60 }),
      simulateCadence({ label: "1000 cps", charsPerSecond: 1000, seconds: 30 }),
      simulateCadence({ label: "40 cps 突发 400ms", charsPerSecond: 40, seconds: 120, burstEveryMs: 400 }),
      simulateCadence({ label: "1000 cps 突发 200ms", charsPerSecond: 1000, seconds: 30, burstEveryMs: 200 }),
    ];
  }
  if (which === "micro") {
    return runMicro();
  }
  if (which === "doc") {
    return runDoc();
  }
  if (which === "caret") {
    return runCaret();
  }
  if (which === "alt") {
    return runAlt();
  }
  if (which.startsWith("stack")) {
    const [, cps, secs] = which.split(":");
    return runStack(Number(cps), Number(secs));
  }
  if (which.startsWith("demo")) {
    const [, cps, secs] = which.split(":");
    return runDemo(Number(cps) || 60, Number(secs) || 60);
  }
  if (which === "baseline") {
    // Sanity check: does a full MarkdownContent re-render dominate on its own?
    const { scroller, host } = makeScroller();
    const root = createRoot(host);
    const text = buildResponse(40_000);
    const samples: number[] = [];
    root.render(createElement(MarkdownContent, { text }));
    await new Promise((resolve) => setTimeout(resolve, 500));
    for (let i = 0; i < 5; i += 1) {
      const t = now();
      root.render(createElement(MarkdownContent, { text: `${text}${"x".repeat(i)}` }));
      void scroller.scrollHeight;
      samples.push(now() - t);
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
    root.unmount();
    scroller.remove();
    return { chars: text.length, samples };
  }
  return { error: `unknown probe: ${which}` };
}

declare global {
  interface Window {
    __PROBE__: { run: (which: string) => Promise<unknown> };
    __PROBE_DEMO__?: { stop: () => void };
  }
}

window.__PROBE__ = { run };
document.title = "feed stream probe ready";
