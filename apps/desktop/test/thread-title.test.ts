import { expect, test } from "bun:test";
import {
  buildThreadTitleRequestBody,
  buildThreadTitleUserMessage,
  extractTitleText,
  parseThreadTitleJson,
  resolveThreadTitleRoute,
  sanitizeThreadTitle,
  shouldReplaceAutoThreadTitle,
  summarizeThreadTitle,
  TITLE_PROMPT_MAX_CHARS,
} from "../src/main/thread-title";
import type { AnthropicProxyRoute } from "../src/main/anthropic-proxy";

const routes: AnthropicProxyRoute[] = [
  {
    role: "explore",
    provider: {
      id: "p0",
      name: "Provider",
      baseUrl: "https://explore.test/",
      requestPath: "",
      defaultModel: "explore-model",
      enabled: true,
      hasApiKey: true,
      apiKey: "explore-key",
      createdAt: "",
      updatedAt: "",
    },
    modelId: "explore-model",
  },
  {
    role: "planner",
    provider: {
      id: "p1",
      name: "Provider",
      baseUrl: "https://gateway.test",
      requestPath: "",
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
      requestPath: "",
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

test("resolveThreadTitleRoute prefers explore over planner and coder", () => {
  expect(resolveThreadTitleRoute(routes)?.role).toBe("explore");
  expect(resolveThreadTitleRoute(routes.filter((r) => r.role !== "explore"))?.role).toBe("planner");
});

test("parseThreadTitleJson reads title field from JSON", () => {
  expect(parseThreadTitleJson('{"title":"程序员工作日报 uTools Plugin"}')).toBe(
    "程序员工作日报 uTools Plugin",
  );
});

test("parseThreadTitleJson extracts JSON from fenced markdown", () => {
  expect(parseThreadTitleJson('```json\n{"title":"任务 TODO 面板"}\n```')).toBe("任务 TODO 面板");
});

test("parseThreadTitleJson returns undefined for missing title field", () => {
  expect(parseThreadTitleJson('{"name":"missing"}')).toBeUndefined();
});

test("summarizes thread title through the explore route with structured output", async () => {
  const calls: Array<{ url: string; body: Record<string, unknown>; headers: Record<string, string> }> =
    [];
  const title = await summarizeThreadTitle(routes, "实现 TODO 列表", async (url, init) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    calls.push({
      url: String(url),
      body,
      headers,
    });
    return new Response(
      JSON.stringify({ content: [{ type: "text", text: '{"title":"任务 TODO 面板"}' }] }),
      {
        status: 200,
      },
    );
  });

  expect(title).toBe("任务 TODO 面板");
  expect(calls).toHaveLength(1);
  expect(calls[0]?.url).toBe("https://explore.test/v1/messages");
  expect(calls[0]?.body.model).toBe("explore-model");
  expect(calls[0]?.body.thinking).toEqual({ type: "disabled" });
  expect(calls[0]?.headers["anthropic-beta"]).toBe("structured-outputs-2025-11-13");
  expect(calls[0]?.body.output_format).toEqual({
    type: "json_schema",
    schema: {
      type: "object",
      properties: { title: { type: "string" } },
      required: ["title"],
      additionalProperties: false,
    },
  });
});

test("summarizeThreadTitle retries without structured output when schema request fails", async () => {
  let callCount = 0;
  const title = await summarizeThreadTitle(routes, "实现导出筛选", async (_url, init) => {
    callCount += 1;
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    if (body.output_format) {
      return new Response("unsupported", { status: 400 });
    }
    return new Response(
      JSON.stringify({ content: [{ type: "text", text: '{"title":"导出筛选功能"}' }] }),
      { status: 200 },
    );
  });

  expect(title).toBe("导出筛选功能");
  expect(callCount).toBe(2);
});

test("rejects empty, copied, refusal, or garbage thread titles", () => {
  expect(sanitizeThreadTitle("实现 TODO 列表", "实现 TODO 列表")).toBeUndefined();
  expect(sanitizeThreadTitle("标题：\"任务状态面板\"", "实现 TODO 列表")).toBe("任务状态面板");
  expect(sanitizeThreadTitle("对不起我不能，只能生成任务标题。", "找 skills")).toBeUndefined();
  expect(sanitizeThreadTitle("导出筛选功能 })]}'}}}", "实现导出")).toBeUndefined();
});

test("shouldReplaceAutoThreadTitle only replaces placeholder", () => {
  expect(shouldReplaceAutoThreadTitle("新编码任务")).toBe(true);
  expect(shouldReplaceAutoThreadTitle("已命名会话")).toBe(false);
});

test("buildThreadTitleUserMessage includes prompt and JSON instruction", () => {
  const message = buildThreadTitleUserMessage("实现导出筛选");
  expect(message).toContain("实现导出筛选");
  expect(message).toContain('{"title":"..."}');
  expect(message).toContain("总长度不超过");
});

test("buildThreadTitleUserMessage truncates long prompts", () => {
  const longPrompt = "x".repeat(TITLE_PROMPT_MAX_CHARS + 500);
  const message = buildThreadTitleUserMessage(longPrompt);
  expect(message).toContain("任务内容已在上方截断");
  expect(message).not.toContain("x".repeat(TITLE_PROMPT_MAX_CHARS + 100));
});

test("buildThreadTitleRequestBody disables thinking", () => {
  const body = buildThreadTitleRequestBody(routes[0]!, "实现导出筛选", true);
  expect(body.thinking).toEqual({ type: "disabled" });
  expect(String(body.system)).toContain("不要输出思考过程");
});

test("buildThreadTitleRequestBody uses route max output tokens when configured", () => {
  const body = buildThreadTitleRequestBody(
    { ...routes[0]!, maxOutputTokens: 4096 },
    "实现导出筛选",
    false,
  );
  expect(body.max_tokens).toBe(4096);
});

test("extractTitleText ignores thinking-only responses", () => {
  const text = extractTitleText({
    content: [{ type: "thinking", thinking: "analyzing prompt..." }],
  });
  expect(text).toBeUndefined();
});

test("extractTitleText prefers text blocks over thinking", () => {
  const text = extractTitleText({
    content: [
      { type: "thinking", thinking: "analyzing prompt..." },
      { type: "text", text: '{"title":"导出筛选功能"}' },
    ],
  });
  expect(text).toBe('{"title":"导出筛选功能"}');
});
