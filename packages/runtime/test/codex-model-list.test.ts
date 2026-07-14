import { describe, expect, test } from "bun:test";
import {
  CODEX_MODEL_LIST_METHOD,
  listCodexModelCatalog,
  parseCodexModelListPage,
} from "../src/codex-model-list";

function catalogEntry(model: string, efforts: readonly string[]): Record<string, unknown> {
  return {
    id: model,
    model,
    displayName: model.toUpperCase(),
    defaultReasoningEffort: efforts[0] ?? "medium",
    supportedReasoningEfforts: efforts.map((reasoningEffort) => ({
      reasoningEffort,
      description: `${reasoningEffort} description`,
    })),
  };
}

describe("listCodexModelCatalog", () => {
  test("paginates model/list and preserves server effort order and open string values", async () => {
    const requests: Array<{ method: string; params: unknown }> = [];
    const responses = [
      {
        data: [catalogEntry("gpt-first", ["max", "low", "focused"])],
        nextCursor: "cursor-2",
      },
      {
        data: [catalogEntry("gpt-second", ["none", "ultra"])],
        nextCursor: null,
      },
    ];
    const client = {
      async request<T>(method: string, params?: unknown): Promise<T> {
        requests.push({ method, params });
        return responses.shift() as T;
      },
    };

    await expect(listCodexModelCatalog(client, { pageSize: 1 })).resolves.toEqual([
      {
        id: "gpt-first",
        model: "gpt-first",
        displayName: "GPT-FIRST",
        defaultReasoningEffort: "max",
        supportedReasoningEfforts: ["max", "low", "focused"],
      },
      {
        id: "gpt-second",
        model: "gpt-second",
        displayName: "GPT-SECOND",
        defaultReasoningEffort: "none",
        supportedReasoningEfforts: ["none", "ultra"],
      },
    ]);
    expect(requests).toEqual([
      {
        method: CODEX_MODEL_LIST_METHOD,
        params: { limit: 1, includeHidden: false },
      },
      {
        method: CODEX_MODEL_LIST_METHOD,
        params: { limit: 1, includeHidden: false, cursor: "cursor-2" },
      },
    ]);
  });

  test("rejects a repeated pagination cursor", async () => {
    const client = {
      async request<T>(): Promise<T> {
        return { data: [], nextCursor: "same-cursor" } as T;
      },
    };

    await expect(listCodexModelCatalog(client)).rejects.toThrow("repeated nextCursor");
  });
});

describe("parseCodexModelListPage", () => {
  test("accepts a valid empty page", () => {
    expect(parseCodexModelListPage({ data: [], nextCursor: null })).toEqual({
      data: [],
      nextCursor: null,
    });
  });

  for (const [name, payload, expected] of [
    ["non-object response", null, "response must be an object"],
    ["missing data", { nextCursor: null }, "response.data must be an array"],
    ["missing next cursor", { data: [] }, "response.nextCursor"],
    [
      "blank effort",
      {
        data: [
          {
            ...catalogEntry("gpt-test", ["low"]),
            supportedReasoningEfforts: [{ reasoningEffort: " ", description: "blank" }],
          },
        ],
        nextCursor: null,
      },
      "reasoningEffort must be a non-empty string",
    ],
    [
      "missing effort description",
      {
        data: [
          {
            ...catalogEntry("gpt-test", ["low"]),
            supportedReasoningEfforts: [{ reasoningEffort: "low" }],
          },
        ],
        nextCursor: null,
      },
      "description must be a string",
    ],
  ] as const) {
    test(`rejects ${name}`, () => {
      expect(() => parseCodexModelListPage(payload)).toThrow(expected);
    });
  }
});
