import { expect, test } from "bun:test";
import type { AnthropicProxyRoute } from "../src/main/anthropic-proxy";
import type { CommitCompactHandoffInput, ThreadCompactHandoffRecord } from "../src/main/conversation-store";
import {
  createEcoCompactService,
  ECOMPACT_INSUFFICIENT_GAIN_ERROR,
  ECOMPACT_INVALID_SUMMARY_ERROR,
  ECOMPACT_NO_COMPRESSIBLE_CONTEXT_ERROR,
  ECOMPACT_NO_SUMMARY_ROUTE_ERROR,
  ECOMPACT_POST_CONTEXT_TOO_LARGE_ERROR,
  ECOMPACT_SOURCE_SESSION_REQUIRED_ERROR,
  ECOMPACT_SUMMARY_CONTEXT_TOO_SMALL_ERROR,
  ECOMPACT_SUMMARY_TIMEOUT_ERROR,
  ECOMPACT_THREAD_NOT_FOUND_ERROR,
} from "../src/main/eco-compact-service";
import { buildEcoCompactHandoffPrompt, CODEX_COMPACT_SUMMARY_PREFIX } from "../src/shared/eco-compact-handoff";

/** Free-form Codex-style handoff (no five-heading requirement). */
const VALID_SUMMARY = [
  "Goal: implement the feature with Eco compaction.",
  "Progress: wired the eco-compact service; tests still pending.",
  "Next: add integration coverage.",
].join("\n");

const COMPACTABLE_ACTIVITY = [
  { id: "1", role: "user", message: "old request" },
  { id: "2", role: "assistant", message: "old answer" },
  { id: "3", role: "user", message: "recent request 1" },
  { id: "4", role: "assistant", message: "recent answer 1" },
  { id: "5", role: "user", message: "recent request 2" },
  { id: "6", role: "assistant", message: "recent answer 2" },
] as const;

const SUCCESS_RUN_INPUT = {
  trigger: "manual" as const,
  sessionId: "sess_1",
  preTokensEstimate: 100_000,
  preTokensSource: "sdk_context_usage" as const,
};

function route(overrides: Partial<AnthropicProxyRoute> = {}): AnthropicProxyRoute {
  return {
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
    ...overrides,
  };
}

function anthropicSummaryResponse(text = VALID_SUMMARY): Response {
  return new Response(
    JSON.stringify({
      type: "message",
      content: [{ type: "text", text }],
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function committedRecord(
  threadId: string,
  input: CommitCompactHandoffInput,
  generation = 1,
): ThreadCompactHandoffRecord {
  return {
    threadId,
    summaryId: `csm_${generation}`,
    schemaVersion: input.schemaVersion ?? 3,
    generation,
    summary: input.summary,
    recentMessages: input.recentMessages.map((message) => ({ ...message })),
    preTokensEstimate: input.preTokensEstimate,
    preTokensSource: input.preTokensSource,
    postTokensEstimate: input.postTokensEstimate,
    postTokensSource: input.postTokensSource,
    compressionRatio: input.compressionRatio,
    sourceSessionId: input.sourceSessionId,
    createdAt: new Date().toISOString(),
  };
}

function largeCompactableActivity() {
  const large = "x".repeat(12_000);
  return [
    { id: "1", role: "user", message: "old request A" },
    { id: "2", role: "assistant", message: `old answer A ${large}` },
    { id: "3", role: "user", message: "old request B" },
    { id: "4", role: "assistant", message: `old answer B ${large}` },
    { id: "5", role: "user", message: "mid request C" },
    { id: "6", role: "assistant", message: `mid answer C ${large}` },
    { id: "7", role: "user", message: "recent request 1" },
    { id: "8", role: "assistant", message: `recent answer 1 ${large}` },
    { id: "9", role: "user", message: "recent request 2" },
    { id: "10", role: "assistant", message: `recent answer 2 ${large}` },
  ];
}

function requestPrompt(init: RequestInit | undefined): string {
  const body = JSON.parse(String(init?.body)) as { messages?: Array<{ content?: string }> };
  return body.messages?.[0]?.content ?? "";
}

function requestSystem(init: RequestInit | undefined): string {
  const body = JSON.parse(String(init?.body)) as { system?: string };
  return body.system ?? "";
}

test("runEcoCompact summarizes older context and keeps recent user messages", async () => {
  const lifecycle: string[] = [];
  const prompts: string[] = [];
  let committed: CommitCompactHandoffInput | undefined;

  const service = createEcoCompactService({
    listActivityLines: async () => [
      { id: "1", role: "user", message: "old request" },
      { id: "2", role: "assistant", message: '[工具调用 Read] {"file":"apps/a.ts"}' },
      { id: "3", role: "user", message: "[工具结果 call_1] TypeError at apps/a.ts:42" },
      { id: "4", role: "assistant", message: "已定位问题" },
      { id: "5", role: "user", message: "middle follow-up" },
      { id: "6", role: "assistant", message: "middle answer" },
      { id: "7", role: "user", message: "recent follow-up" },
      { id: "8", role: "assistant", message: "recent answer" },
    ],
    getThreadPrompt: () => "实现功能",
    getLatestCompactSummary: () => undefined,
    commitCompactHandoff: (threadId, input) => {
      lifecycle.push("commit");
      committed = input;
      return committedRecord(threadId, input);
    },
    resolveProxyRoutes: () => [route()],
    fetcher: async (_input, init) => {
      prompts.push(requestPrompt(init));
      expect(requestSystem(init)).toContain("CONTEXT CHECKPOINT COMPACTION");
      return anthropicSummaryResponse();
    },
  });

  const result = await service.runEcoCompact("thr_1", SUCCESS_RUN_INPUT);
  expect(lifecycle).toEqual(["commit"]);
  expect(committed?.sourceSessionId).toBe("sess_1");
  expect(committed?.summary).toBe(VALID_SUMMARY);
  expect(committed?.schemaVersion).toBe(3);
  expect(committed?.recentMessages).toEqual([
    { id: "1", role: "user", message: "old request" },
    { id: "5", role: "user", message: "middle follow-up" },
    { id: "7", role: "user", message: "recent follow-up" },
  ]);
  expect(committed?.recentMessages.every((message) => message.role === "user")).toBe(true);
  expect(result.preTokensEstimate).toBe(100_000);
  expect(result.preTokensSource).toBe("sdk_context_usage");
  expect(result.postTokensEstimate).toBeGreaterThan(2_000);
  expect(result.compressionRatio).toBeLessThan(1);
  expect(prompts[0]).toContain("[工具调用 Read]");
  expect(prompts[0]).toContain("[工具结果 call_1] TypeError");
  expect(prompts[0]).toContain("已定位问题");
});

test("runEcoCompact requires an explicit source session", async () => {
  let committed = false;
  const service = createEcoCompactService({
    listActivityLines: async () => [...COMPACTABLE_ACTIVITY],
    getThreadPrompt: () => "实现功能",
    getLatestCompactSummary: () => undefined,
    commitCompactHandoff: () => {
      committed = true;
      throw new Error("must not commit");
    },
    resolveProxyRoutes: () => [route()],
  });

  await expect(service.runEcoCompact("thr_1", { trigger: "manual", sessionId: "  " })).rejects.toThrow(
    ECOMPACT_SOURCE_SESSION_REQUIRED_ERROR,
  );
  expect(committed).toBe(false);
});

test("runEcoCompact rejects when the thread record is missing", async () => {
  let readHistory = false;
  let committed = false;
  const service = createEcoCompactService({
    listActivityLines: async () => {
      readHistory = true;
      return [...COMPACTABLE_ACTIVITY];
    },
    getThreadPrompt: () => undefined,
    getLatestCompactSummary: () => undefined,
    commitCompactHandoff: () => {
      committed = true;
      throw new Error("must not commit");
    },
    resolveProxyRoutes: () => [route()],
  });

  await expect(service.runEcoCompact("thr_missing", SUCCESS_RUN_INPUT)).rejects.toThrow(
    ECOMPACT_THREAD_NOT_FOUND_ERROR,
  );
  expect(readHistory).toBe(false);
  expect(committed).toBe(false);
});

test("runEcoCompact rejects when no summary route exists", async () => {
  let committed = false;
  const service = createEcoCompactService({
    listActivityLines: async () => [...COMPACTABLE_ACTIVITY],
    getThreadPrompt: () => "实现功能",
    getLatestCompactSummary: () => undefined,
    commitCompactHandoff: () => {
      committed = true;
      throw new Error("must not commit");
    },
    resolveProxyRoutes: () => undefined,
  });

  await expect(service.runEcoCompact("thr_1", SUCCESS_RUN_INPUT)).rejects.toThrow(
    ECOMPACT_NO_SUMMARY_ROUTE_ERROR,
  );
  expect(committed).toBe(false);
});

test("runEcoCompact rejects HTTP summary failures without committing", async () => {
  let committed = false;
  const service = createEcoCompactService({
    listActivityLines: async () => [...COMPACTABLE_ACTIVITY],
    getThreadPrompt: () => "实现功能",
    getLatestCompactSummary: () => undefined,
    commitCompactHandoff: () => {
      committed = true;
      throw new Error("must not commit");
    },
    resolveProxyRoutes: () => [route()],
    fetcher: async () => new Response("upstream unavailable", { status: 503 }),
  });

  await expect(service.runEcoCompact("thr_1", SUCCESS_RUN_INPUT)).rejects.toThrow(
    "摘要请求失败（Test/test-model）：HTTP 503；upstream unavailable",
  );
  expect(committed).toBe(false);
});

test("runEcoCompact rejects empty summaries without requiring five headings", async () => {
  let committed = false;
  const service = createEcoCompactService({
    listActivityLines: async () => [...COMPACTABLE_ACTIVITY],
    getThreadPrompt: () => "实现功能",
    getLatestCompactSummary: () => undefined,
    commitCompactHandoff: () => {
      committed = true;
      throw new Error("must not commit");
    },
    resolveProxyRoutes: () => [route()],
    fetcher: async () => anthropicSummaryResponse(""),
  });

  await expect(service.runEcoCompact("thr_1", SUCCESS_RUN_INPUT)).rejects.toThrow(
    ECOMPACT_INVALID_SUMMARY_ERROR,
  );
  expect(committed).toBe(false);

  // Free-form / incomplete heading text is accepted when non-empty.
  const freeformOk = createEcoCompactService({
    listActivityLines: async () => [...COMPACTABLE_ACTIVITY],
    getThreadPrompt: () => "实现功能",
    getLatestCompactSummary: () => undefined,
    commitCompactHandoff: (threadId, input) => committedRecord(threadId, input),
    resolveProxyRoutes: () => [route()],
    fetcher: async () => anthropicSummaryResponse("## 任务目标\n实现功能 — free-form is fine"),
  });
  await expect(freeformOk.runEcoCompact("thr_1", SUCCESS_RUN_INPUT)).resolves.toMatchObject({
    summary: expect.stringContaining("实现功能"),
  });
});

test("runEcoCompact rejects summary timeout instead of fabricating a fallback", async () => {
  let committed = false;
  const service = createEcoCompactService({
    listActivityLines: async () => [...COMPACTABLE_ACTIVITY],
    getThreadPrompt: () => "实现功能",
    getLatestCompactSummary: () => undefined,
    commitCompactHandoff: () => {
      committed = true;
      throw new Error("must not commit");
    },
    resolveProxyRoutes: () => [route()],
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

  await expect(service.runEcoCompact("thr_1", SUCCESS_RUN_INPUT)).rejects.toThrow(
    ECOMPACT_SUMMARY_TIMEOUT_ERROR,
  );
  expect(committed).toBe(false);
});

test("runEcoCompact refuses to commit when only user messages remain in recent keep", async () => {
  let fetched = false;
  let committed = false;
  const service = createEcoCompactService({
    listActivityLines: async () => [
      { id: "1", role: "user", message: "only user one" },
      { id: "2", role: "user", message: "only user two" },
    ],
    getThreadPrompt: () => "实现功能",
    getLatestCompactSummary: () => undefined,
    commitCompactHandoff: () => {
      committed = true;
      throw new Error("must not commit");
    },
    resolveProxyRoutes: () => [route()],
    fetcher: async () => {
      fetched = true;
      return anthropicSummaryResponse();
    },
  });

  await expect(service.runEcoCompact("thr_1", SUCCESS_RUN_INPUT)).rejects.toThrow(
    ECOMPACT_NO_COMPRESSIBLE_CONTEXT_ERROR,
  );
  expect(fetched).toBe(false);
  expect(committed).toBe(false);
});

test("runEcoCompact rejects insufficient compression gain before committing", async () => {
  let committed = false;
  const service = createEcoCompactService({
    listActivityLines: async () => [...COMPACTABLE_ACTIVITY],
    getThreadPrompt: () => "实现功能",
    getLatestCompactSummary: () => undefined,
    commitCompactHandoff: () => {
      committed = true;
      throw new Error("must not commit");
    },
    resolveProxyRoutes: () => [route()],
    fetcher: async () => anthropicSummaryResponse(),
  });

  await expect(
    service.runEcoCompact("thr_1", {
      trigger: "manual",
      sessionId: "sess_1",
      preTokensEstimate: 3_000,
      preTokensSource: "sdk_context_usage",
    }),
  ).rejects.toThrow(ECOMPACT_INSUFFICIENT_GAIN_ERROR);
  expect(committed).toBe(false);
});

test("runEcoCompact rejects a handoff that remains above the safe context watermark", async () => {
  let committed = false;
  const largeRecent = "r".repeat(5_000);
  const service = createEcoCompactService({
    listActivityLines: async () => [
      { id: "1", role: "user", message: "old request" },
      { id: "2", role: "assistant", message: "old answer" },
      { id: "3", role: "user", message: `recent request 1 ${largeRecent}` },
      { id: "4", role: "assistant", message: `recent answer 1 ${largeRecent}` },
      { id: "5", role: "user", message: `recent request 2 ${largeRecent}` },
      { id: "6", role: "assistant", message: `recent answer 2 ${largeRecent}` },
    ],
    getThreadPrompt: () => "实现功能",
    getLatestCompactSummary: () => undefined,
    commitCompactHandoff: () => {
      committed = true;
      throw new Error("must not commit");
    },
    resolveProxyRoutes: () => [route({ contextTokens: 6_000, maxOutputTokens: 0 })],
    fetcher: async () => anthropicSummaryResponse(),
  });

  await expect(service.runEcoCompact("thr_1", SUCCESS_RUN_INPUT)).rejects.toThrow(
    ECOMPACT_POST_CONTEXT_TOO_LARGE_ERROR,
  );
  expect(committed).toBe(false);
});

test("runEcoCompact rejects a summary route whose context cannot fit a safe summary request", async () => {
  let fetched = false;
  let committed = false;
  const service = createEcoCompactService({
    listActivityLines: async () => [...COMPACTABLE_ACTIVITY],
    getThreadPrompt: () => "实现功能",
    getLatestCompactSummary: () => undefined,
    commitCompactHandoff: () => {
      committed = true;
      throw new Error("must not commit");
    },
    resolveProxyRoutes: () => [route({ contextTokens: 3_000, maxOutputTokens: 4_096 })],
    fetcher: async () => {
      fetched = true;
      return anthropicSummaryResponse();
    },
  });

  await expect(service.runEcoCompact("thr_1", SUCCESS_RUN_INPUT)).rejects.toThrow(
    ECOMPACT_SUMMARY_CONTEXT_TOO_SMALL_ERROR,
  );
  expect(fetched).toBe(false);
  expect(committed).toBe(false);
});

test("runEcoCompact does not commit when the single summary request fails", async () => {
  let requestCount = 0;
  let committed = false;
  const service = createEcoCompactService({
    listActivityLines: async () => largeCompactableActivity(),
    getThreadPrompt: () => "实现大型功能",
    getLatestCompactSummary: () => undefined,
    commitCompactHandoff: () => {
      committed = true;
      throw new Error("must not commit");
    },
    resolveProxyRoutes: () => [route({ contextTokens: 8_000, maxOutputTokens: 4_096 })],
    fetcher: async () => {
      requestCount += 1;
      return new Response("summary failed", { status: 502 });
    },
  });

  await expect(service.runEcoCompact("thr_1", SUCCESS_RUN_INPUT)).rejects.toThrow(
    "HTTP 502；summary failed",
  );
  expect(requestCount).toBe(1);
  expect(committed).toBe(false);
});

test("runEcoCompact drops oldest history until the compact prompt fits, then issues one summary request", async () => {
  const prompts: string[] = [];
  let committed = 0;
  const service = createEcoCompactService({
    listActivityLines: async () => largeCompactableActivity(),
    getThreadPrompt: () => "实现大型功能",
    getLatestCompactSummary: () => undefined,
    commitCompactHandoff: (threadId, input) => {
      committed += 1;
      return committedRecord(threadId, input);
    },
    resolveProxyRoutes: () => [route({ contextTokens: 8_000, maxOutputTokens: 4_096 })],
    fetcher: async (_input, init) => {
      prompts.push(requestPrompt(init));
      return anthropicSummaryResponse();
    },
  });

  const result = await service.runEcoCompact("thr_1", SUCCESS_RUN_INPUT);
  expect(result.droppedOldestMessages).toBeGreaterThan(0);
  expect(prompts).toHaveLength(1);
  expect(prompts[0]).toContain("## Conversation to compact");
  expect(prompts[0]).not.toContain("This is chunk");
  expect(prompts[0]).not.toContain("Merge the following partial");
  // Oldest large items should have been dropped so the remaining prompt fits.
  expect(prompts[0]).not.toContain("old request A");
  expect(committed).toBe(1);
});

test("runEcoCompact fails when even after dropping oldest messages the summary prompt cannot fit", async () => {
  let requestCount = 0;
  let committed = false;
  const huge = "x".repeat(40_000);
  const service = createEcoCompactService({
    listActivityLines: async () => [
      { id: "1", role: "user", message: `only compressible ${huge}` },
      { id: "2", role: "assistant", message: `assistant ${huge}` },
    ],
    getThreadPrompt: () => "实现大型功能",
    getLatestCompactSummary: () => undefined,
    commitCompactHandoff: () => {
      committed = true;
      throw new Error("must not commit");
    },
    // Window large enough to start summary output budget path, but each message alone still overfills.
    resolveProxyRoutes: () => [route({ contextTokens: 6_000, maxOutputTokens: 4_096 })],
    fetcher: async () => {
      requestCount += 1;
      return anthropicSummaryResponse();
    },
  });

  await expect(service.runEcoCompact("thr_1", SUCCESS_RUN_INPUT)).rejects.toThrow(
    ECOMPACT_SUMMARY_CONTEXT_TOO_SMALL_ERROR,
  );
  expect(requestCount).toBe(0);
  expect(committed).toBe(false);
});

test("runEcoCompact rolling summary includes the prior generation and strips the injected envelope", async () => {
  const previous = committedRecord(
    "thr_1",
    {
      sourceSessionId: "sess_old",
      sourceStartMessageId: "old_start",
      sourceEndMessageId: "old_end",
      summary: "Prior handoff: 旧摘要任务事实",
      recentMessages: [{ role: "user", message: "上一代近期事实" }],
      preTokensEstimate: 90_000,
      preTokensSource: "sdk_context_usage",
      postTokensEstimate: 10_000,
      postTokensSource: "local_heuristic",
      compressionRatio: 1 / 9,
      schemaVersion: 3,
    },
    3,
  );
  previous.targetSessionId = "sess_1";
  previous.consumedAt = new Date().toISOString();
  const injected = buildEcoCompactHandoffPrompt("实现功能", "new follow-up from handoff", previous);
  let prompt = "";

  const service = createEcoCompactService({
    listActivityLines: async () => [
      { id: "1", role: "user", message: injected },
      { id: "2", role: "assistant", message: "new answer" },
      { id: "3", role: "user", message: "recent request 1" },
      { id: "4", role: "assistant", message: "recent answer 1" },
      { id: "5", role: "user", message: "recent request 2" },
      { id: "6", role: "assistant", message: "recent answer 2" },
    ],
    getThreadPrompt: () => "实现功能",
    getLatestCompactSummary: () => previous,
    commitCompactHandoff: (threadId, input) => committedRecord(threadId, input, 4),
    resolveProxyRoutes: () => [route()],
    fetcher: async (_input, init) => {
      prompt = requestPrompt(init);
      return anthropicSummaryResponse();
    },
  });

  const result = await service.runEcoCompact("thr_1", SUCCESS_RUN_INPUT);
  expect(result.generation).toBe(4);
  expect(prompt).toContain("Previous compaction handoff (generation 3)");
  expect(prompt).toContain("旧摘要任务事实");
  expect(prompt).toContain("上一代近期事实");
  // Stripped follow-up is a recent user keep (not re-summarized as older envelope body).
  expect(result.recentMessages.some((message) => message.message.includes("new follow-up from handoff"))).toBe(
    true,
  );
  expect(prompt).not.toContain(CODEX_COMPACT_SUMMARY_PREFIX);
});

test("runEcoCompact reports summary timeout and leaves the old session untouched", async () => {
  let committed = false;
  const service = createEcoCompactService({
    listActivityLines: async () => largeCompactableActivity(),
    getThreadPrompt: () => "实现大型功能",
    getLatestCompactSummary: () => undefined,
    commitCompactHandoff: () => {
      committed = true;
      throw new Error("must not commit");
    },
    resolveProxyRoutes: () => [route({ contextTokens: 8_000, maxOutputTokens: 4_096 })],
    summaryTimeoutMs: 20,
    fetcher: async (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(new DOMException("The operation was aborted.", "AbortError")),
          { once: true },
        );
      }),
  });

  await expect(service.runEcoCompact("thr_1", SUCCESS_RUN_INPUT)).rejects.toThrow(ECOMPACT_SUMMARY_TIMEOUT_ERROR);
  expect(committed).toBe(false);
});

test("runEcoCompact accepts free-form summary with ungrounded test-success claim (soft quality only)", async () => {
  let committed = 0;
  const fabricated = `${VALID_SUMMARY}\n全量测试通过。`;
  const service = createEcoCompactService({
    listActivityLines: async () => [...COMPACTABLE_ACTIVITY],
    getThreadPrompt: () => "实现功能",
    getLatestCompactSummary: () => undefined,
    commitCompactHandoff: (threadId, input) => {
      committed += 1;
      return committedRecord(threadId, input);
    },
    resolveProxyRoutes: () => [route()],
    fetcher: async () => anthropicSummaryResponse(fabricated),
  });

  const result = await service.runEcoCompact("thr_1", SUCCESS_RUN_INPUT);
  expect(result.summary).toContain("全量测试通过");
  expect(committed).toBe(1);
});
