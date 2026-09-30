import { expect, test } from "bun:test";
import { createFeedMarkdownDoc } from "../src/renderer/prosemirror/feed-markdown";
import { streamCaretPosition } from "../src/renderer/streaming-markdown-caret";

function endBlockTag(markdown: string): { tag: string | null; atEnd: boolean } {
  const doc = createFeedMarkdownDoc(markdown);
  const pos = streamCaretPosition(doc);
  const $pos = doc.resolve(pos);
  const parent = $pos.parent;
  return {
    tag: parent.type.name,
    // The reveal edge must be at the very end of that block's content.
    atEnd: $pos.parentOffset === parent.content.size,
  };
}

test("the caret lands inside the last text block, at its end", () => {
  for (const [markdown, expected] of [
    ["正文输出", "paragraph"],
    ["正文输出\n\n第二段", "paragraph"],
    ["# 标题\n\n正文", "paragraph"],
    ["- 列表 a\n- 列表 b", "paragraph"],
    ["- 外层\n  - 内层\n\n    - 更深", "paragraph"],
    ["说明\n\n```ts\nconst a = 1;", "code_block"],
    ["| a | b |\n| --- | --- |\n| 1 | 2 |", "table_cell"],
    ["> 引用\n> 第二行", "paragraph"],
  ] as const) {
    const result = endBlockTag(markdown);
    expect(`${markdown} -> ${result.tag}`).toBe(`${markdown} -> ${expected}`);
    expect(`${markdown} end=${result.atEnd}`).toBe(`${markdown} end=true`);
  }
});

test("the caret never sits between top-level blocks", () => {
  // Regression: doc.content.size put the widget on its own line below the last
  // block, which added a line to the message.
  for (const markdown of ["正文输出", "正文输出\n\n第二段\n\n收尾", "- a\n- b", "# 标题"]) {
    const doc = createFeedMarkdownDoc(markdown);
    expect(streamCaretPosition(doc)).toBeLessThan(doc.content.size);
  }
});

test("an atomic last block falls back to a position after it", () => {
  const doc = createFeedMarkdownDoc("正文\n\n---");
  const pos = streamCaretPosition(doc);
  const $pos = doc.resolve(pos);
  expect($pos.parent.type.name).toBe("doc");
  expect($pos.parentOffset).toBe(doc.content.size);
});
