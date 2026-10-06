import type { Node as PMNode } from "prosemirror-model";
import {
  createFeedMarkdownDoc,
  feedMarkdownBlockRanges,
  feedMarkdownSchema,
} from "./prosemirror/feed-markdown";

/**
 * Incremental ProseMirror document builder for a streamed Markdown response.
 *
 * A paced reveal re-renders the response many times per second. Parsing the
 * whole accumulated text on every tick is O(message) per tick — on a long answer
 * that dominates the frame budget and forces a coarse cadence, which is what
 * makes streamed text look like it jumps instead of flows.
 *
 * Instead, the settled part of the response is parsed once per *block* and its
 * nodes are reused verbatim; only the open region (the last block plus the live
 * tail) is re-parsed per tick. Per-tick cost then tracks the size of the block
 * being written, not the size of the message, which is what makes a frame-rate
 * reveal affordable.
 *
 * The hard part is knowing what is settled. Markdown block structure is not
 * append-only: `a | b` is a paragraph until `--- | ---` turns the pair into a GFM
 * table, `标题` is a paragraph until `---` makes it a setext heading, and two
 * lists separated by a blank line are one list. Only the *last* top-level block
 * of a prefix can still be re-read that way, so the seal trail keeps one block
 * open — and the block list comes from the tokenizer, which knows the real
 * structure, rather than from a line scan.
 */

export interface StreamingMarkdownDocCache {
  /** Text already parsed into `sealedNodes`; always a block-boundary prefix. */
  sealedText: string;
  /** Top-level nodes for `sealedText`, reused across ticks so ProseMirror keeps their DOM. */
  sealedNodes: PMNode[];
  /** Committed text the current `settledOffset` was derived from (append-only in practice). */
  settledScanText: string;
  /** Offset up to which `settledScanText` is settled. */
  settledOffset: number;
  /**
   * Set when the text uses constructs that cannot be split at block boundaries
   * (raw HTML containers, link reference definitions). The builder then parses
   * the whole text per tick — the previous behaviour — instead of risking a
   * wrong split.
   */
  monolithic: boolean;
  /** Duration of the last build in ms, used to pick the paced tick interval. */
  lastBuildMs: number;
}

export function createStreamingMarkdownDocCache(): StreamingMarkdownDocCache {
  return {
    sealedText: "",
    sealedNodes: [],
    settledScanText: "",
    settledOffset: 0,
    monolithic: false,
    lastBuildMs: 0,
  };
}

function resetStreamingMarkdownDocCache(cache: StreamingMarkdownDocCache): void {
  cache.sealedText = "";
  cache.sealedNodes = [];
  cache.settledScanText = "";
  cache.settledOffset = 0;
  cache.monolithic = false;
}

/**
 * Link reference definitions are document-scoped: `[a]: url` declared in one
 * block applies to the whole document, so splitting at block boundaries can turn
 * a reference into literal text.
 */
const LINK_REFERENCE_DEFINITION = /^ {0,3}\[[^\]\n]+\]:[ \t]*\S/m;

/**
 * Raw HTML blocks are stitched across blank lines (`installHtmlContainerStitch`),
 * so a container opened in one block and closed in another has to stay in one
 * parse. A line whose first non-space character starts a tag is the only way a
 * markdown-it `html_block` token can begin; inline HTML mid-line is per-block and
 * safe to split.
 */
const HTML_BLOCK_LINE = /^ {0,3}<[A-Za-z!/?]/m;

export function isIncrementalMarkdownSafe(text: string): boolean {
  if (!text) {
    return true;
  }
  return !LINK_REFERENCE_DEFINITION.test(text) && !HTML_BLOCK_LINE.test(text);
}

/**
 * Offset up to which `committedText` can be parsed once and reused.
 *
 * Everything before the last tokenizer block is settled; the last block stays
 * mutable because later text can still be read as its continuation.
 *
 * Rescanning is keyed on the committed text itself: the block structure only
 * changes when the committed prefix grows, which happens once per completed
 * block rather than once per tick.
 */
function settledOffsetFor(cache: StreamingMarkdownDocCache, committedText: string): number {
  if (cache.settledScanText === committedText) {
    return cache.settledOffset;
  }
  // Only the open region needs rescanning. Everything before the seal was
  // already parsed as its own top-level block, and an unchanged boundary region
  // cannot start merging with it later.
  const base = cache.sealedText.length;
  const ranges = feedMarkdownBlockRanges(committedText.slice(base));
  cache.settledScanText = committedText;
  cache.settledOffset = base + (ranges.length >= 2 ? ranges[ranges.length - 2]!.end : 0);
  return cache.settledOffset;
}

function topLevelNodes(doc: PMNode): PMNode[] {
  const nodes: PMNode[] = [];
  doc.forEach((child) => {
    nodes.push(child);
  });
  return nodes;
}

function parseNodes(text: string): PMNode[] {
  return text ? topLevelNodes(createFeedMarkdownDoc(text)) : [];
}

function buildDoc(nodes: readonly PMNode[]): PMNode {
  return nodes.length === 0
    ? createFeedMarkdownDoc("")
    : feedMarkdownSchema.node("doc", null, [...nodes]);
}

function goMonolithic(
  cache: StreamingMarkdownDocCache,
  whole: string,
): PMNode {
  resetStreamingMarkdownDocCache(cache);
  cache.monolithic = true;
  return createFeedMarkdownDoc(whole);
}

/**
 * Build the document for `committed + mutableTail`.
 *
 * `committed` is the parser-committed prefix; `mutableTail` is the incomplete
 * remainder that must be re-parsed on every tick.
 */
export function buildStreamingMarkdownDoc(
  cache: StreamingMarkdownDocCache,
  committed: string,
  mutableTail: string,
): PMNode {
  const startedAt = typeof performance === "undefined" ? 0 : performance.now();
  const doc = buildStreamingMarkdownDocInner(cache, committed, mutableTail);
  cache.lastBuildMs = (typeof performance === "undefined" ? 0 : performance.now()) - startedAt;
  return doc;
}

function buildStreamingMarkdownDocInner(
  cache: StreamingMarkdownDocCache,
  committed: string,
  mutableTail: string,
): PMNode {
  const whole = mutableTail ? `${committed}${mutableTail}` : committed;

  // A non-append rewrite (restore, regenerate, replay) invalidates every seal.
  if (!committed.startsWith(cache.sealedText)) {
    resetStreamingMarkdownDocCache(cache);
  }
  if (cache.monolithic) {
    return createFeedMarkdownDoc(whole);
  }

  const settled = settledOffsetFor(cache, committed);
  if (settled > cache.sealedText.length) {
    const increment = committed.slice(cache.sealedText.length, settled);
    if (!isIncrementalMarkdownSafe(increment)) {
      return goMonolithic(cache, whole);
    }
    cache.sealedNodes.push(...parseNodes(increment));
    cache.sealedText = committed.slice(0, settled);
  }

  // Only the open region is re-examined per tick: text that was already checked
  // while open cannot become unsafe by sitting still.
  const mutable = committed.slice(cache.sealedText.length) + mutableTail;
  if (!isIncrementalMarkdownSafe(mutable)) {
    // The open region needs whole-document context (a stitched HTML container or
    // a link reference definition). Parse everything for this build; the seals
    // already earned stay valid because the trigger is inside the open region.
    return createFeedMarkdownDoc(whole);
  }
  return buildDoc([...cache.sealedNodes, ...parseNodes(mutable)]);
}
