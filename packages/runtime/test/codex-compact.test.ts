import { expect, test } from "bun:test";
import { PassThrough } from "node:stream";
import { CodexAppServerClient } from "../src/codex-app-server-client";
import {
  buildCodexThreadCompactParams,
  CODEX_COMPACT_METHOD,
  CodexCompactNotAvailable,
  compactCodexThread,
  compactCodexThreadAndWait,
} from "../src/codex-compact";

function writeResponse(stdout: PassThrough, message: unknown): void {
  stdout.write(`${JSON.stringify(message)}\n`);
}

function writeNotification(stdout: PassThrough, method: string, params: unknown): void {
  writeResponse(stdout, { method, params });
}

function compactItemParams(
  threadId = "codex-thread-1",
  turnId = "compact-turn-1",
  itemId = "compact-item-1",
): Record<string, unknown> {
  return {
    threadId,
    turnId,
    item: { type: "contextCompaction", id: itemId },
  };
}

function tokenUsageParams(
  totalTokens: number,
  threadId = "codex-thread-1",
  turnId = "compact-turn-1",
): Record<string, unknown> {
  return {
    threadId,
    turnId,
    tokenUsage: {
      total: {
        totalTokens,
        inputTokens: totalTokens,
        cachedInputTokens: 0,
        outputTokens: 0,
        reasoningOutputTokens: 0,
      },
      last: {
        totalTokens,
        inputTokens: totalTokens,
        cachedInputTokens: 0,
        outputTokens: 0,
        reasoningOutputTokens: 0,
      },
      modelContextWindow: 200_000,
    },
  };
}

function turnCompletedParams(
  status: "completed" | "failed" | "interrupted",
  threadId = "codex-thread-1",
  turnId = "compact-turn-1",
  error: unknown = null,
): Record<string, unknown> {
  return {
    threadId,
    turn: { id: turnId, status, error },
  };
}

test("buildCodexThreadCompactParams trims and locks request shape", () => {
  expect(
    buildCodexThreadCompactParams({
      threadId: " codex-thread-1 ",
    }),
  ).toEqual({
    threadId: "codex-thread-1",
  });
});

test("buildCodexThreadCompactParams rejects missing thread id without fallback", () => {
  expect(() =>
    buildCodexThreadCompactParams({
      threadId: " ",
    }),
  ).toThrow(CodexCompactNotAvailable);
});

test("compactCodexThread sends thread/compact/start to the app-server client", async () => {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const client = new CodexAppServerClient(stdin, stdout);

  const compact = compactCodexThread(client, {
    threadId: "codex-thread-1",
  });
  await Bun.sleep(0);
  writeResponse(stdout, {
    id: 1,
    result: {},
  });

  await expect(compact).resolves.toEqual({});
  const written = stdin.read()?.toString() ?? "";
  const lines = written
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  expect(lines).toEqual([
    {
      id: 1,
      method: CODEX_COMPACT_METHOD,
      params: {
        threadId: "codex-thread-1",
      },
    },
  ]);
});

test("compactCodexThreadAndWait does not treat the empty start acknowledgement as completion", async () => {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const client = new CodexAppServerClient(stdin, stdout);
  let settled = false;

  const compact = compactCodexThreadAndWait(client, { threadId: "codex-thread-1" }, { timeoutMs: 1_000 });
  void compact.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );

  writeResponse(stdout, { id: 1, result: {} });
  await Bun.sleep(5);
  expect(settled).toBe(false);

  writeNotification(stdout, "item/started", compactItemParams());
  writeNotification(stdout, "thread/tokenUsage/updated", tokenUsageParams(12_345));
  writeNotification(stdout, "item/completed", compactItemParams());
  writeNotification(stdout, "turn/completed", turnCompletedParams("completed"));

  await expect(compact).resolves.toEqual({
    threadId: "codex-thread-1",
    turnId: "compact-turn-1",
    itemId: "compact-item-1",
    postTokens: 12_345,
  });
});

test("compactCodexThreadAndWait ignores unrelated events and keeps the latest usage for its turn", async () => {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const client = new CodexAppServerClient(stdin, stdout);

  const compact = compactCodexThreadAndWait(client, { threadId: "codex-thread-1" }, { timeoutMs: 1_000 });
  writeResponse(stdout, { id: 1, result: {} });
  writeNotification(stdout, "item/started", compactItemParams("other-thread", "other-turn", "other-item"));
  writeNotification(stdout, "item/started", compactItemParams());
  writeNotification(
    stdout,
    "thread/tokenUsage/updated",
    tokenUsageParams(99_999, "other-thread", "compact-turn-1"),
  );
  writeNotification(
    stdout,
    "thread/tokenUsage/updated",
    tokenUsageParams(88_888, "codex-thread-1", "other-turn"),
  );
  writeNotification(stdout, "thread/tokenUsage/updated", tokenUsageParams(20_000));
  writeNotification(stdout, "thread/tokenUsage/updated", tokenUsageParams(9_000));
  writeNotification(
    stdout,
    "item/completed",
    compactItemParams("codex-thread-1", "other-turn", "compact-item-1"),
  );
  writeNotification(stdout, "turn/completed", turnCompletedParams("completed", "other-thread"));
  writeNotification(stdout, "item/completed", compactItemParams());
  writeNotification(stdout, "turn/completed", turnCompletedParams("completed"));

  await expect(compact).resolves.toMatchObject({
    turnId: "compact-turn-1",
    itemId: "compact-item-1",
    postTokens: 9_000,
  });
});

for (const status of ["failed", "interrupted"] as const) {
  test(`compactCodexThreadAndWait rejects a ${status} compaction turn`, async () => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const client = new CodexAppServerClient(stdin, stdout);

    const compact = compactCodexThreadAndWait(client, { threadId: "codex-thread-1" }, { timeoutMs: 1_000 });
    const outcome = compact.catch((error: unknown) => error);
    writeResponse(stdout, { id: 1, result: {} });
    writeNotification(stdout, "item/started", compactItemParams());
    writeNotification(
      stdout,
      "turn/completed",
      turnCompletedParams(status, "codex-thread-1", "compact-turn-1", {
        message: "provider rejected compact",
      }),
    );

    const error = await outcome;
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(
      new RegExp(`compact-turn-1 ${status}: provider rejected compact`),
    );
  });
}

test("compactCodexThreadAndWait times out when completion has no post-compact usage", async () => {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const client = new CodexAppServerClient(stdin, stdout);

  const compact = compactCodexThreadAndWait(client, { threadId: "codex-thread-1" }, { timeoutMs: 50 });
  writeResponse(stdout, { id: 1, result: {} });
  writeNotification(stdout, "item/started", compactItemParams());
  writeNotification(stdout, "item/completed", compactItemParams());
  writeNotification(stdout, "turn/completed", turnCompletedParams("completed"));

  await expect(compact).rejects.toThrow(/missing: post-compaction token usage/);
});

test("compactCodexThreadAndWait rejects invalid post-compact usage", async () => {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const client = new CodexAppServerClient(stdin, stdout);

  const compact = compactCodexThreadAndWait(client, { threadId: "codex-thread-1" }, { timeoutMs: 1_000 });
  const outcome = compact.catch((error: unknown) => error);
  writeResponse(stdout, { id: 1, result: {} });
  writeNotification(stdout, "item/started", compactItemParams());
  writeNotification(stdout, "thread/tokenUsage/updated", {
    threadId: "codex-thread-1",
    turnId: "compact-turn-1",
    tokenUsage: { last: { totalTokens: "unknown" } },
  });

  const error = await outcome;
  expect(error).toBeInstanceOf(Error);
  expect((error as Error).message).toMatch(/invalid tokenUsage\.last\.totalTokens/);
});

test("compactCodexThreadAndWait rejects when aborted", async () => {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const client = new CodexAppServerClient(stdin, stdout);
  const controller = new AbortController();

  const compact = compactCodexThreadAndWait(
    client,
    { threadId: "codex-thread-1" },
    { signal: controller.signal, timeoutMs: 1_000 },
  );
  writeResponse(stdout, { id: 1, result: {} });
  writeNotification(stdout, "item/started", compactItemParams());
  controller.abort(new Error("compact cancelled"));

  await expect(compact).rejects.toThrow("compact cancelled");
});
