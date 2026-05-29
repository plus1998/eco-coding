import { expect, test } from "bun:test";
import { classifyThreadIntent } from "../src/main/thread-intent";

test("classifies implementation requests as coding", () => {
  expect(classifyThreadIntent("实现停止功能并加测试")).toBe("coding");
  expect(classifyThreadIntent("How to implement rollback support?")).toBe("coding");
  expect(classifyThreadIntent("fix the duplicated activity log output")).toBe("coding");
});

test("classifies explanatory prompts as question", () => {
  expect(classifyThreadIntent("这个项目的 runtime 是怎么工作的？")).toBe("question");
  expect(classifyThreadIntent("why does the planner ask for approval?")).toBe("question");
  expect(classifyThreadIntent("解释一下当前的 MCP 配置")).toBe("question");
});
