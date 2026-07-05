import { expect, test } from "bun:test";
import { createEcoCompactService, ECOMPACT_SUMMARY_TIMEOUT_ERROR } from "../src/main/eco-compact-service";

test("runEcoCompact saves handoff, clears sdk session, and returns token estimate", async () => {
  let cleared = false;
  let saved:
    | {
        summary: string;
        recentUserMessages: string[];
        postTokensEstimate: number;
      }
    | undefined;

  const service = createEcoCompactService({
    listActivityLines: async () => [
      { id: "1", role: "user", message: "older ".repeat(25_000) },
      { id: "2", role: "user", message: "recent follow-up" },
    ],
    getThreadPrompt: () => "实现功能",
    saveCompactHandoff: (_threadId, input) => {
      saved = input;
      return {
        threadId: "thr_1",
        ...input,
        createdAt: new Date().toISOString(),
      };
    },
    clearSdkSession: () => {
      cleared = true;
    },
    resolveProxyRoutes: () => [
      {
        role: "planner",
        provider: {
          id: "prov_1",
          name: "Test",
          baseUrl: "http://127.0.0.1:8080",
          requestPath: "",
          apiKey: "",
          enabled: true,
          apiCompat: "anthropic",
        },
        modelId: "test-model",
      },
    ],
    fetcher: async () =>
      new Response(
        JSON.stringify({
          type: "message",
          content: [{ type: "text", text: "已完成路由与测试摘要" }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
  });

  const result = await service.runEcoCompact("thr_1", { trigger: "manual" });
  expect(cleared).toBe(true);
  expect(saved?.summary).toContain("已完成路由与测试摘要");
  expect(saved?.recentUserMessages).toEqual(["recent follow-up"]);
  expect(result.postTokensEstimate).toBeGreaterThan(0);
});

test("runEcoCompact rejects summary timeout instead of using fallback", async () => {
  let saved = false;
  let cleared = false;

  const service = createEcoCompactService({
    listActivityLines: async () => [{ id: "1", role: "user", message: "older message" }],
    getThreadPrompt: () => "实现功能",
    saveCompactHandoff: () => {
      saved = true;
      return {
        threadId: "thr_1",
        summary: "should not save",
        recentUserMessages: [],
        postTokensEstimate: 1,
        createdAt: new Date().toISOString(),
      };
    },
    clearSdkSession: () => {
      cleared = true;
    },
    resolveProxyRoutes: () => [
      {
        role: "planner",
        provider: {
          id: "prov_1",
          name: "Test",
          baseUrl: "http://127.0.0.1:8080",
          requestPath: "",
          apiKey: "",
          enabled: true,
          apiCompat: "anthropic",
        },
        modelId: "test-model",
      },
    ],
    summaryTimeoutMs: 20,
    fetcher: (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(new DOMException("The operation was aborted.", "AbortError")),
          { once: true },
        );
      }),
  });

  await expect(service.runEcoCompact("thr_1", { trigger: "manual" })).rejects.toThrow(
    ECOMPACT_SUMMARY_TIMEOUT_ERROR,
  );
  expect(saved).toBe(false);
  expect(cleared).toBe(false);
});
