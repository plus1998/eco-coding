import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import "../src/renderer/i18n";
import { ImageGalleryFloat } from "../src/renderer/ImageGalleryFloat";
import {
  type ImageGalleryQueueItem,
  imageGalleryDisplayItem,
  imageGalleryGenerationItem,
} from "../src/renderer/image-gallery-float-state";

const noop = () => {};

function renderFloat(items: ImageGalleryQueueItem[]) {
  return renderToStaticMarkup(
    createElement(ImageGalleryFloat, {
      items,
      onAdvance: noop,
      onCloseAll: noop,
    }),
  );
}

test("renders the right-docked gallery as a vertical queue of three layers at most", () => {
  const items = [
    imageGalleryGenerationItem("art-gen", 0),
    imageGalleryGenerationItem("art-gen", 1),
    imageGalleryGenerationItem("art-gen", 2),
    imageGalleryDisplayItem("art-disp"),
  ];
  const markup = renderFloat(items);
  expect(markup).toContain('class="image-gallery-float"');
  expect(markup).toContain('aria-label="图片画廊"');
  // 队列只显示前三张，第四张等前三张关闭后再出现。
  const frameCount = (markup.match(/class="image-gallery-card-frame"/g) ?? []).length;
  expect(frameCount).toBe(3);
  // 只有当前一张带关闭 / 预览操作图标。
  const closeIcons = (markup.match(/image-gallery-card-overlay--close/g) ?? []).length;
  const previewIcons = (markup.match(/image-gallery-card-overlay--preview/g) ?? []).length;
  expect(closeIcons).toBe(1);
  expect(previewIcons).toBe(1);
});

test("the current card exposes close and preview icons, peek cards are inert", () => {
  const markup = renderFloat([imageGalleryDisplayItem("art-1"), imageGalleryDisplayItem("art-2")]);
  expect(markup).toContain("image-gallery-card-media--loading");
  expect(markup).toContain('aria-label="关闭这张"');
  expect(markup).toContain('aria-label="图片预览"');
  const closeIcons = (markup.match(/image-gallery-card-overlay--close/g) ?? []).length;
  expect(closeIcons).toBe(1);
});
