import { afterEach, expect, test } from "bun:test";
import {
  formatIntegratedWebSearchResults,
  searchDoubaoWeb,
  searchIntegratedWeb,
  searchTavilyWeb,
} from "../src/pi-integrated-web-search.js";
import { createPiIntegratedWebSearchExtensionFactory } from "../src/pi-integrated-web-search-factory.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("searchTavilyWeb maps Tavily results", async () => {
  let capturedInit: RequestInit | undefined;
  globalThis.fetch = (async (_input, init) => {
    capturedInit = init;
    return new Response(
      JSON.stringify({
        results: [
          {
            title: "Example",
            url: "https://example.com",
            content: "Snippet text",
          },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as typeof fetch;

  const results = await searchTavilyWeb("weather shanghai", "tvly-test-key");
  expect(results).toEqual([
    { title: "Example", url: "https://example.com", description: "Snippet text" },
  ]);
  expect(capturedInit?.method).toBe("POST");
  const headers = capturedInit?.headers as Record<string, string> | undefined;
  expect(headers?.Authorization).toBe("Bearer tvly-test-key");
});

test("searchIntegratedWeb dispatches tavily", async () => {
  globalThis.fetch = (async (_input, init) => {
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    expect(body.query).toBe("hello");
    return new Response(JSON.stringify({ results: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  await searchIntegratedWeb("tavily", "hello", "tvly-key");
});

test("formatIntegratedWebSearchResults labels Tavily", () => {
  const text = formatIntegratedWebSearchResults("tavily", "q", [
    { title: "A", url: "https://a.test", description: "d" },
  ]);
  expect(text).toContain("Tavily Search results");
});

test("integrated extension factory reports tavily provider in details", async () => {
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        results: [{ title: "Hit", url: "https://hit.test", content: "body" }],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    )) as typeof fetch;

  const tools: Array<{
    execute: (
      toolCallId: string,
      params: Record<string, unknown>,
      signal: AbortSignal | undefined,
      onUpdate: unknown,
      ctx: { cwd: string },
    ) => Promise<{ details: Record<string, unknown> }>;
  }> = [];
  const factory = createPiIntegratedWebSearchExtensionFactory({
    provider: "tavily",
    apiKey: "tvly-key",
  });
  factory({
    registerTool(tool) {
      tools.push(tool);
    },
  });
  const result = await tools[0]!.execute("id", { query: "news" }, undefined, undefined, { cwd: "/" });
  expect(result.details.provider).toBe("tavily");
  expect(result.details.resultCount).toBe(1);
});

test("searchDoubaoWeb maps Global API documents", async () => {
  let capturedInit: RequestInit | undefined;
  globalThis.fetch = (async (_input, init) => {
    capturedInit = init;
    return new Response(
      JSON.stringify({
        Result: {
          TotalDocCount: 1,
          Documents: [
            {
              Title: "Shanghai Weather",
              Url: "https://weather.example/shanghai",
              Snippet: [{ Type: "text", Text: "Sunny, 28C" }],
            },
          ],
          ErrorCode: 0,
          ErrorMsg: "",
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as typeof fetch;

  const results = await searchDoubaoWeb("weather shanghai", "doubao-test-key");
  expect(results).toEqual([
    {
      title: "Shanghai Weather",
      url: "https://weather.example/shanghai",
      description: "Sunny, 28C",
    },
  ]);
  expect(capturedInit?.method).toBe("POST");
  const body = capturedInit?.body ? JSON.parse(String(capturedInit.body)) : {};
  expect(body.Query).toBe("weather shanghai");
  expect(body.DocCount).toBe(5);
  const headers = capturedInit?.headers as Record<string, string> | undefined;
  expect(headers?.Authorization).toBe("Bearer doubao-test-key");
});

test("searchDoubaoWeb throws on ResponseMetadata error", async () => {
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        ResponseMetadata: {
          Error: { CodeN: 10406, Message: "quota exhausted" },
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    )) as typeof fetch;

  await expect(searchDoubaoWeb("q", "key")).rejects.toThrow(/quota exhausted/i);
});

test("searchIntegratedWeb dispatches doubao", async () => {
  globalThis.fetch = (async (_input, init) => {
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    expect(body.Query).toBe("hello");
    return new Response(
      JSON.stringify({ Result: { Documents: [], ErrorCode: 0, ErrorMsg: "" } }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as typeof fetch;

  await searchIntegratedWeb("doubao", "hello", "doubao-key");
});

test("formatIntegratedWebSearchResults labels Doubao", () => {
  const text = formatIntegratedWebSearchResults("doubao", "q", [
    { title: "A", url: "https://a.test", description: "d" },
  ]);
  expect(text).toContain("Doubao Search results");
});
