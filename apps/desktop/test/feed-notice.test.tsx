import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FeedNotice } from "../src/renderer/FeedNotice";

test("feed notice renders the common prompt structure and actions", () => {
  const markup = renderToStaticMarkup(
    createElement(FeedNotice, {
      title: "完整访问权限已开启",
      description: createElement(
        "p",
        null,
        "Eco 可以在未经批准的情况下编辑文件。",
        createElement("a", { href: "#risks" }, "了解更多"),
      ),
      primaryAction: { label: "不再显示", onClick: () => undefined },
      dismissAction: { label: "关闭提醒", onClick: () => undefined },
      role: "alert",
      className: "custom-notice",
    }),
  );

  expect(markup).toContain('class="feed-notice custom-notice"');
  expect(markup).toContain('role="alert"');
  expect(markup).toContain('aria-live="assertive"');
  expect(markup).toContain("完整访问权限已开启");
  expect(markup).toContain('<a href="#risks">了解更多</a>');
  expect(markup).toContain('class="feed-notice-primary-action"');
  expect(markup).toContain('aria-label="关闭提醒"');
  expect(markup).not.toContain("feed-notice-action-icon");
});

test("feed notice omits the action region when no actions are supplied", () => {
  const markup = renderToStaticMarkup(
    createElement(FeedNotice, {
      title: "缓存已过期",
      description: "新建对话可以重新利用提示词缓存。",
    }),
  );

  expect(markup).toContain('role="status"');
  expect(markup).toContain('aria-live="polite"');
  expect(markup).not.toContain("feed-notice-actions");
  expect(markup).not.toContain("feed-notice-dismiss-action");
});
