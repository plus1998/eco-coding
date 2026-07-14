import { describe, expect, test } from "bun:test";
import {
  buildCodexExternalAgentConfigDetectParams,
  buildCodexExternalAgentConfigImportParams,
  CODEX_EXTERNAL_AGENT_CONFIG_DETECT_METHOD,
  CODEX_EXTERNAL_AGENT_CONFIG_IMPORT_COMPLETED_METHOD,
  CODEX_EXTERNAL_AGENT_CONFIG_IMPORT_METHOD,
  type CodexExternalAgentConfigImportCompleted,
  CodexExternalAgentConfigImportFailed,
  type CodexExternalAgentConfigMigrationItem,
  detectCodexExternalAgentConfig,
  importCodexExternalAgentConfig,
  importCodexExternalAgentConfigAndWait,
  parseCodexExternalAgentConfigDetectResponse,
  parseCodexExternalAgentConfigImportCompleted,
} from "../src/codex-external-agent-config";

function details(): NonNullable<CodexExternalAgentConfigMigrationItem["details"]> {
  return {
    plugins: [{ marketplaceName: "team", pluginNames: ["github"] }],
    sessions: [{ path: "/home/me/.claude/session.jsonl", cwd: "/repo", title: "Fix CI" }],
    mcpServers: [{ name: "github" }],
    hooks: [{ name: "pre-tool" }],
    subagents: [{ name: "reviewer" }],
    commands: [{ name: "review" }],
  };
}

function migrationItem(
  overrides: Partial<CodexExternalAgentConfigMigrationItem> = {},
): CodexExternalAgentConfigMigrationItem {
  return {
    itemType: "SKILLS",
    description: "Import Claude skills",
    cwd: "/repo",
    details: null,
    ...overrides,
  };
}

function completion(
  importId: string,
  options: { failure?: boolean; itemTypeResults?: unknown[] } = {},
): CodexExternalAgentConfigImportCompleted | Record<string, unknown> {
  return {
    importId,
    itemTypeResults: options.itemTypeResults ?? [
      {
        itemType: "SKILLS",
        successes: options.failure
          ? []
          : [
              {
                itemType: "SKILLS",
                cwd: "/repo",
                source: "/repo/.claude/skills",
                target: "/repo/.codex/skills",
              },
            ],
        failures: options.failure
          ? [
              {
                itemType: "SKILLS",
                errorType: "copy_failed",
                failureStage: "skills_import",
                message: "permission denied",
                cwd: "/repo",
                source: "/repo/.claude/skills",
              },
            ]
          : [],
      },
    ],
  };
}

describe("detectCodexExternalAgentConfig", () => {
  test("sends includeHome/cwds and preserves structured migration details", async () => {
    const requests: Array<{ method: string; params: unknown }> = [];
    const item = migrationItem({ itemType: "PLUGINS", details: details() });
    const client = {
      async request<T>(method: string, params?: unknown): Promise<T> {
        requests.push({ method, params });
        return { items: [item] } as T;
      },
    };

    await expect(
      detectCodexExternalAgentConfig(client, { includeHome: true, cwds: ["/repo"] }),
    ).resolves.toEqual([item]);
    expect(requests).toEqual([
      {
        method: CODEX_EXTERNAL_AGENT_CONFIG_DETECT_METHOD,
        params: { includeHome: true, cwds: ["/repo"] },
      },
    ]);
  });

  test("uses explicit detect defaults", () => {
    expect(buildCodexExternalAgentConfigDetectParams()).toEqual({
      includeHome: false,
      cwds: [],
    });
    expect(buildCodexExternalAgentConfigDetectParams({ cwds: null })).toEqual({
      includeHome: false,
      cwds: null,
    });
  });

  test("applies 0.142.5 defaults only to omitted migration detail arrays", () => {
    expect(
      parseCodexExternalAgentConfigDetectResponse({
        items: [
          {
            itemType: "PLUGINS",
            description: "Import plugins",
            details: {
              plugins: [{ marketplaceName: "team", pluginNames: ["github"] }],
            },
          },
        ],
      }),
    ).toEqual([
      {
        itemType: "PLUGINS",
        description: "Import plugins",
        details: {
          plugins: [{ marketplaceName: "team", pluginNames: ["github"] }],
          sessions: [],
          mcpServers: [],
          hooks: [],
          subagents: [],
          commands: [],
        },
      },
    ]);
  });

  test("accepts omitted migration cwd/details and omitted nullable session title", () => {
    expect(
      parseCodexExternalAgentConfigDetectResponse({
        items: [
          { itemType: "SKILLS", description: "Import skills" },
          {
            itemType: "SESSIONS",
            description: "Import sessions",
            cwd: null,
            details: { sessions: [{ path: "/home/me/session.jsonl", cwd: "/repo" }] },
          },
        ],
      }),
    ).toEqual([
      { itemType: "SKILLS", description: "Import skills" },
      {
        itemType: "SESSIONS",
        description: "Import sessions",
        cwd: null,
        details: {
          plugins: [],
          sessions: [{ path: "/home/me/session.jsonl", cwd: "/repo" }],
          mcpServers: [],
          hooks: [],
          subagents: [],
          commands: [],
        },
      },
    ]);
  });
});

describe("importCodexExternalAgentConfig", () => {
  test("sends explicit migrationItems/source and validates the acknowledgement", async () => {
    const requests: Array<{ method: string; params: unknown }> = [];
    const item = migrationItem();
    const client = {
      async request<T>(method: string, params?: unknown): Promise<T> {
        requests.push({ method, params });
        return { importId: "import-1" } as T;
      },
    };

    await expect(
      importCodexExternalAgentConfig(client, { migrationItems: [item], source: "eco-coding" }),
    ).resolves.toEqual({ importId: "import-1" });
    expect(requests).toEqual([
      {
        method: CODEX_EXTERNAL_AGENT_CONFIG_IMPORT_METHOD,
        params: { migrationItems: [item], source: "eco-coding" },
      },
    ]);
  });

  test("requires non-empty migrationItems because empty imports never emit completed", () => {
    expect(() => buildCodexExternalAgentConfigImportParams({ migrationItems: [], source: null })).toThrow(
      "does not emit completed for an empty import",
    );
  });

  test("requires source to be explicit", () => {
    expect(() =>
      buildCodexExternalAgentConfigImportParams({
        migrationItems: [migrationItem()],
      } as never),
    ).toThrow("source must be explicit");
  });
});

describe("importCodexExternalAgentConfigAndWait", () => {
  test("buffers same-batch completion, ignores other import ids, and resolves the acknowledged id", async () => {
    const handlers = new Set<(method: string, params: unknown) => void>();
    const target = completion("import-target");
    const client = {
      addNotificationHandler(handler: (method: string, params: unknown) => void): () => void {
        handlers.add(handler);
        return () => handlers.delete(handler);
      },
      async request<T>(): Promise<T> {
        for (const handler of handlers) {
          handler(CODEX_EXTERNAL_AGENT_CONFIG_IMPORT_COMPLETED_METHOD, completion("import-other"));
          handler(CODEX_EXTERNAL_AGENT_CONFIG_IMPORT_COMPLETED_METHOD, target);
        }
        return { importId: "import-target" } as T;
      },
    };

    await expect(
      importCodexExternalAgentConfigAndWait(
        client,
        { migrationItems: [migrationItem()], source: null },
        { timeoutMs: 1_000 },
      ),
    ).resolves.toEqual(target);
    expect(handlers.size).toBe(0);
  });

  test("rejects item failures instead of treating completed as success", async () => {
    const handlers = new Set<(method: string, params: unknown) => void>();
    const client = {
      addNotificationHandler(handler: (method: string, params: unknown) => void): () => void {
        handlers.add(handler);
        return () => handlers.delete(handler);
      },
      async request<T>(): Promise<T> {
        for (const handler of handlers) {
          handler(
            CODEX_EXTERNAL_AGENT_CONFIG_IMPORT_COMPLETED_METHOD,
            completion("import-failed", { failure: true }),
          );
        }
        return { importId: "import-failed" } as T;
      },
    };

    const error = await importCodexExternalAgentConfigAndWait(
      client,
      { migrationItems: [migrationItem()], source: "eco-coding" },
      { timeoutMs: 1_000 },
    ).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(CodexExternalAgentConfigImportFailed);
    expect((error as CodexExternalAgentConfigImportFailed).failures).toEqual([
      expect.objectContaining({ message: "permission denied", failureStage: "skills_import" }),
    ]);
    expect(handlers.size).toBe(0);
  });

  test("rejects completion that omits results for a selected type", async () => {
    const handlers = new Set<(method: string, params: unknown) => void>();
    const client = {
      addNotificationHandler(handler: (method: string, params: unknown) => void): () => void {
        handlers.add(handler);
        return () => handlers.delete(handler);
      },
      async request<T>(): Promise<T> {
        for (const handler of handlers) {
          handler(
            CODEX_EXTERNAL_AGENT_CONFIG_IMPORT_COMPLETED_METHOD,
            completion("import-empty", { itemTypeResults: [] }),
          );
        }
        return { importId: "import-empty" } as T;
      },
    };

    await expect(
      importCodexExternalAgentConfigAndWait(
        client,
        { migrationItems: [migrationItem()], source: null },
        { timeoutMs: 1_000 },
      ),
    ).rejects.toThrow("completed without results for: SKILLS");
  });
});

describe("strict external-agent response parsing", () => {
  test("accepts omitted and explicit-null optional completion fields", () => {
    expect(
      parseCodexExternalAgentConfigImportCompleted({
        importId: "import-1",
        itemTypeResults: [
          {
            itemType: "SKILLS",
            successes: [
              { itemType: "SKILLS" },
              { itemType: "SKILLS", cwd: null, source: null, target: null },
            ],
            failures: [
              { itemType: "SKILLS", failureStage: "copy", message: "failed" },
              {
                itemType: "SKILLS",
                errorType: null,
                failureStage: "copy",
                message: "failed again",
                cwd: null,
                source: null,
              },
            ],
          },
        ],
      }),
    ).toEqual({
      importId: "import-1",
      itemTypeResults: [
        {
          itemType: "SKILLS",
          successes: [{ itemType: "SKILLS" }, { itemType: "SKILLS", cwd: null, source: null, target: null }],
          failures: [
            { itemType: "SKILLS", failureStage: "copy", message: "failed" },
            {
              itemType: "SKILLS",
              errorType: null,
              failureStage: "copy",
              message: "failed again",
              cwd: null,
              source: null,
            },
          ],
        },
      ],
    });
  });

  for (const [name, callback, expected] of [
    [
      "unknown migration type",
      () =>
        parseCodexExternalAgentConfigDetectResponse({
          items: [migrationItem({ itemType: "UNKNOWN" as never })],
        }),
      "must be one of",
    ],
    [
      "invalid migration detail array",
      () =>
        parseCodexExternalAgentConfigDetectResponse({
          items: [migrationItem({ details: { plugins: null } as never })],
        }),
      ".plugins must be an array",
    ],
    [
      "invalid optional completion field",
      () =>
        parseCodexExternalAgentConfigImportCompleted({
          importId: "import-1",
          itemTypeResults: [
            {
              itemType: "SKILLS",
              successes: [{ itemType: "SKILLS", target: 1 }],
              failures: [],
            },
          ],
        }),
      ".target must be a string or null",
    ],
    [
      "child result type mismatch",
      () =>
        parseCodexExternalAgentConfigImportCompleted({
          importId: "import-1",
          itemTypeResults: [
            {
              itemType: "SKILLS",
              successes: [{ itemType: "HOOKS", cwd: null, source: null, target: null }],
              failures: [],
            },
          ],
        }),
      "must match parent result SKILLS",
    ],
    [
      "duplicate type results",
      () =>
        parseCodexExternalAgentConfigImportCompleted({
          importId: "import-1",
          itemTypeResults: [
            { itemType: "SKILLS", successes: [], failures: [] },
            { itemType: "SKILLS", successes: [], failures: [] },
          ],
        }),
      "duplicate SKILLS results",
    ],
  ] as const) {
    test(`rejects ${name}`, () => {
      expect(callback).toThrow(expected);
    });
  }
});
