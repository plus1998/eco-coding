import type { ReactNode } from "react";
import { MarkdownContent } from "./MarkdownContent";
import { i18n } from "./i18n";

/**
 * 查看图像工具预览弹窗右侧的内容位。
 *
 * 这个工具是唯一一个"问了才知道答案"的调用：只看图片无法判断模型被问了什么、答了什么。
 * 提示词与返回文本各写各的一块——工具还在跑时只有提示词，历史记录里可能只有返回文本，
 * 有哪块就显示哪块。两块都空时返回 undefined，调用方据此完全不加 slot，预览保持纯图片。
 *
 * 两块用不同的排版是有意的：返回文本是视觉模型写的一份完整答复，本来就是 Markdown
 * （标题、列表、代码块），按原文渲染才对得上它想表达的结构；提示词是调用方自己的
 * 一句话，属于输入而不是排版过的文档，按字面显示——当成 Markdown 渲染会把 `a*b`、
 * `#` 这类字符吃掉，看到的就不再是实际问出去的那句话。
 */
export function imageViewAnalysisPanel(prompt?: string, output?: string): ReactNode | undefined {
  const promptText = prompt?.trim();
  const resultText = output?.trim();
  if (!promptText && !resultText) {
    return undefined;
  }
  return (
    <>
      {promptText ? (
        <section className="run-log-image-view-side-block">
          <span className="run-log-image-view-side-label">{i18n.t("activity.imageView.promptLabel")}</span>
          <pre className="run-log-image-view-side-text">{promptText}</pre>
        </section>
      ) : null}
      {resultText ? (
        <section className="run-log-image-view-side-block is-result">
          <span className="run-log-image-view-side-label">{i18n.t("activity.imageView.resultLabel")}</span>
          <MarkdownContent text={resultText} className="run-log-image-view-side-markdown" />
        </section>
      ) : null}
    </>
  );
}
