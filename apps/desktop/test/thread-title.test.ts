import { expect, test } from "bun:test";
import {
  buildThreadTitleRequestBody,
  buildThreadTitleUserMessage,
  extractTitleJsonFromThinking,
  extractTitleText,
  previewThreadTitleFromStream,
  parseThreadTitleJson,
  resolvePendingThreadTitle,
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

test("parseThreadTitleJson accepts adjacent JSON objects from duplicated upstream output", () => {
  expect(parseThreadTitleJson('{"title":"连接远程主机"}{"title":"连接远程主机"}')).toBe("连接远程主机");
});

test("parseThreadTitleJson preserves braces inside a title while scanning adjacent objects", () => {
  expect(parseThreadTitleJson('{"title":"配置 {host} 连接"}{"title":"备用标题"}')).toBe("配置 {host} 连接");
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
      JSON.stringify({
        type: "message",
        content: [{ type: "text", text: '{"title":"任务 TODO 面板"}' }],
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
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
      JSON.stringify({
        type: "message",
        content: [{ type: "text", text: '{"title":"导出筛选功能"}' }],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
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
  expect(shouldReplaceAutoThreadTitle("新任务")).toBe(true);
  expect(shouldReplaceAutoThreadTitle("New Task")).toBe(true);
  expect(shouldReplaceAutoThreadTitle("新编码任务")).toBe(true);
  expect(shouldReplaceAutoThreadTitle("已命名会话")).toBe(false);
});

test("resolvePendingThreadTitle uses locale language", () => {
  expect(resolvePendingThreadTitle("zh-CN")).toBe("新任务");
  expect(resolvePendingThreadTitle("en-US")).toBe("New Task");
  expect(resolvePendingThreadTitle("ja-JP")).toBe("New Task");
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

test("extractTitleJsonFromThinking reads JSON embedded in thinking blocks", () => {
  const text = extractTitleJsonFromThinking({
    content: [{ type: "thinking", thinking: '只输出 JSON：{"title":"模型身份询问"}' }],
  });
  expect(parseThreadTitleJson(text)).toBe("模型身份询问");
});

test("summarizeThreadTitle recovers title from thinking-only upstream responses", async () => {
  const title = await summarizeThreadTitle(routes, "你是什么模型", async () => {
    return new Response(
      JSON.stringify({
        stop_reason: "max_tokens",
        type: "message",
        content: [
          {
            type: "thinking",
            thinking: '用户要求生成标题。只输出 JSON：{"title":"模型身份询问"}',
          },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  });

  expect(title).toBe("模型身份询问");
});

test("previewThreadTitleFromStream reads partial JSON while streaming", () => {
  expect(previewThreadTitleFromStream('{"title":"导出筛')).toBe("导出筛");
  expect(previewThreadTitleFromStream('{"title":"任务 TODO 面板"}')).toBe("任务 TODO 面板");
});

test("summarizeThreadTitle streams title preview through onTitleDelta", async () => {
  const previews: string[] = [];
  const title = await summarizeThreadTitle(
    routes,
    "实现导出筛选",
    async () =>
      new Response(
        JSON.stringify({
          type: "message",
          content: [{ type: "text", text: '{"title":"导出筛选功能"}' }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    (preview) => {
      previews.push(preview);
    },
  );

  expect(title).toBe("导出筛选功能");
  expect(previews).toEqual(["导出筛选功能"]);
});

test("summarizeThreadTitle routes openai chat through bridge with disable-thinking kwargs", async () => {
  const qwenRoutes: AnthropicProxyRoute[] = [
    {
      role: "explore",
      apiCompat: "openai_chat_completions",
      provider: {
        id: "p0",
        name: "llama.cpp",
        baseUrl: "http://127.0.0.1:8080",
        requestPath: "",
        defaultModel: "qwen3.6-27b",
        enabled: true,
        hasApiKey: true,
        apiKey: "",
        apiCompat: "openai_chat_completions",
        createdAt: "",
        updatedAt: "",
      },
      modelId: "qwen3.6-27b",
    },
  ];

  let requestUrl = "";
  let upstreamBody: Record<string, unknown> | undefined;
  const title = await summarizeThreadTitle(qwenRoutes, "实现导出筛选", async (url, init) => {
    requestUrl = String(url);
    upstreamBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(
      JSON.stringify({
        choices: [{ message: { role: "assistant", content: '{"title":"导出筛选"}' } }],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  });

  expect(title).toBe("导出筛选");
  expect(requestUrl).toBe("http://127.0.0.1:8080/v1/chat/completions");
  expect(upstreamBody?.chat_template_kwargs).toEqual({ enable_thinking: false });
  expect(upstreamBody?.stream).toBe(true);
});
