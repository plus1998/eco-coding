import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CoderTodoPanel } from "../src/renderer/CoderTodoPanel";
import type { CoderTodoItem } from "../src/shared/ipc";

const todos: CoderTodoItem[] = [
  {
    id: "t1",
    position: 0,
    title: "打包安装包并验证更新链路",
    detail: "正在写入签名脚本",
    status: "running",
  },
  {
    id: "t2",
    position: 1,
    title: "补测试",
    detail: "",
    status: "pending",
  },
  {
    id: "t3",
    position: 2,
    title: "已完成项",
    detail: "",
    status: "completed",
  },
];

test("compact todo panel fuses status and step index into one marker", () => {
  const markup = renderToStaticMarkup(
    createElement(CoderTodoPanel, { todos, embedded: true, compact: true }),
  );

  expect(markup).toContain("coder-todo-list-compact");
  expect(markup).toContain("coder-todo-status-index is-running");
  expect(markup).toContain("coder-todo-status-index is-pending");
  expect(markup).toContain("coder-todo-status-index is-completed");
  expect(markup).toContain("正在写入签名脚本");
  expect(markup).toContain("补测试");
  // Index digits live inside the fused marker, not as "#1" prose.
  expect(markup).toContain(">1</span>");
  expect(markup).toContain(">2</span>");
  expect(markup).not.toContain("#1");
  expect(markup).not.toContain("#2");
  expect(markup).not.toContain("coder-todo-index");
  expect(markup).not.toContain("coder-todo-icon");
});

test("non-compact todo panel still shows status labels without separate # prefixes", () => {
  const markup = renderToStaticMarkup(createElement(CoderTodoPanel, { todos }));

  expect(markup).toContain("coder-todo-status-index is-running");
  expect(markup).toContain("coder-todo-status");
  expect(markup).not.toContain("#1");
  expect(markup).not.toContain("coder-todo-index");
});
