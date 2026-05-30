import { expect, test } from "bun:test";
import {
  buildThreadTitleUserMessage,
  sanitizeThreadTitle,
  summarizeThreadTitleWithCoder,
} from "../src/main/thread-title";
import type { AnthropicProxyRoute } from "../src/main/anthropic-proxy";

const routes: AnthropicProxyRoute[] = [
  {
    role: "planner",
    provider: {
      id: "p1",
      name: "Provider",
      baseUrl: "https://gateway.test",
      defaultModel: "planner-model",
      enabled: true,
      hasApiKey: true,
      apiKey: "planner-key",
      createdAt: "",
      updatedAt: "",
    },
    modelId: "planner-model",
  },
  {
    role: "coder",
    provider: {
      id: "p2",
      name: "Provider",
      baseUrl: "https://coder.test/",
      defaultModel: "coder-model",
      enabled: true,
      hasApiKey: true,
      apiKey: "coder-key",
      createdAt: "",
      updatedAt: "",
    },
    modelId: "coder-model",
  },
];

test("summarizes thread title through the coder route", async () => {
  const calls: Array<{ url: string; body: { model: string } }> = [];
  const title = await summarizeThreadTitleWithCoder(routes, "实现 TODO 列表", async (url, init) => {
    const body = JSON.parse(String(init?.body)) as { model: string };
    calls.push({
      url: String(url),
      body: { model: body.model },
    });
    return new Response(JSON.stringify({ content: [{ type: "text", text: "任务 TODO 面板" }] }), {
      status: 200,
    });
  });

  expect(title).toBe("任务 TODO 面板");
  expect(calls).toEqual([{ url: "https://coder.test/v1/messages", body: { model: "coder-model" } }]);
});

test("rejects empty or copied thread titles", () => {
  expect(sanitizeThreadTitle("实现 TODO 列表", "实现 TODO 列表")).toBeUndefined();
  expect(sanitizeThreadTitle("标题：\"任务状态面板\"", "实现 TODO 列表")).toBe("任务状态面板");
});

test("buildThreadTitleUserMessage includes plan context", () => {
  const message = buildThreadTitleUserMessage("实现导出筛选", {
    analysis: "需要改 API",
    plan: "## Implementation Plan\n- 加 query 参数",
  });
  expect(message).toContain("实现导出筛选");
  expect(message).toContain("## 分析摘要");
  expect(message).toContain("需要改 API");
  expect(message).toContain("## 实现计划摘要");
  expect(message).toContain("query 参数");
});
