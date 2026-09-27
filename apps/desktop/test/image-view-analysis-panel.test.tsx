import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import "../src/renderer/i18n";
import { imageViewAnalysisPanel } from "../src/renderer/image-view-analysis-panel";

function render(prompt?: string, output?: string) {
  const panel = imageViewAnalysisPanel(prompt, output);
  return panel === undefined ? undefined : renderToStaticMarkup(panel);
}

test("prompt and returned text each get their own labelled block", () => {
  const markup = render("找报错", "第 3 行的类型不匹配。");
  expect(markup).toContain("查看提示词");
  expect(markup).toContain("找报错");
  expect(markup).toContain("工具返回");
  expect(markup).toContain("第 3 行的类型不匹配。");
  // 返回文本那块独占剩余高度，长答案在面板内自己滚动。
  expect(markup).toContain("run-log-image-view-side-block is-result");
});

test("an image view with neither prompt nor answer leaves the slot empty", () => {
  expect(render(undefined, undefined)).toBeUndefined();
  expect(render("   ", "\n")).toBeUndefined();
});

test("the prompt alone still fills the slot while the tool is still running", () => {
  const markup = render("找报错", undefined);
  expect(markup).toContain("查看提示词");
  expect(markup).not.toContain("工具返回");
});

test("a recorded answer without a prompt still fills the slot", () => {
  const markup = render(undefined, "第 3 行的类型不匹配。");
  expect(markup).not.toContain("查看提示词");
  expect(markup).toContain("工具返回");
});

test("the answer is rendered as Markdown, not as raw source", () => {
  const markup = render("找报错", "## 结论\n\n- 第 3 行类型不匹配\n- 第 7 行少个括号");
  expect(markup).toContain("<h2");
  expect(markup).toContain("结论");
  expect(markup).toContain("<li");
  // 面板内自己滚动，长答案不会把弹窗顶开。
  expect(markup).toContain("run-log-image-view-side-markdown");
});

test("the prompt stays verbatim so what was asked is what is shown", () => {
  // 提示词是调用方原话，当成 Markdown 会把 ** 吃掉；这里显示的就是实际发出去的那串字符。
  const markup = render("**加粗** 和 a*b", undefined);
  expect(markup).toContain("**加粗** 和 a*b");
  expect(markup).not.toContain("<strong>");
});

test("multi-line answers keep their line breaks instead of collapsing", () => {
  const markup = render("找报错", "第一行\n第二行");
  expect(markup).toContain("第一行");
  expect(markup).toContain("第二行");
});
