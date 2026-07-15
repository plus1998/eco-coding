import { expect, test } from "bun:test";
import { PassThrough } from "node:stream";
import { CodexAppServerClient } from "../src/codex-app-server-client";
import {
  buildCodexThreadRollbackParams,
  CODEX_ROLLBACK_METHOD,
  CodexRollbackNotAvailable,
  rollbackCodexThread,
} from "../src/codex-rollback";

function writeResponse(stdout: PassThrough, message: unknown): void {
  stdout.write(`${JSON.stringify(message)}\n`);
}

test("buildCodexThreadRollbackParams trims and locks request shape", () => {
  expect(
    buildCodexThreadRollbackParams({
      threadId: " codex-thread-1 ",
      itemId: " item-user-2 ",
    }, 2),
  ).toEqual({
    threadId: "codex-thread-1",
    numTurns: 2,
  });
});

test("buildCodexThreadRollbackParams rejects missing target without fallback", () => {
  expect(() =>
    buildCodexThreadRollbackParams({
      threadId: "codex-thread-1",
      itemId: " ",
    }, 1),
  ).toThrow(CodexRollbackNotAvailable);
});

test("rollbackCodexThread sends thread/rollback to the app-server client", async () => {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const client = new CodexAppServerClient(stdin, stdout);

  const rollback = rollbackCodexThread(client, {
    threadId: "codex-thread-1",
    itemId: "item-user-2",
  });
  await Bun.sleep(0);
  writeResponse(stdout, {
    id: 1,
    result: {
      thread: {
        turns: [
          { items: [{ type: "userMessage", id: "item-user-1" }] },
          { items: [{ type: "userMessage", id: "server-item-2", clientId: "item-user-2" }] },
          { items: [{ type: "userMessage", id: "item-user-3" }] },
        ],
      },
    },
  });
  await Bun.sleep(0);
  writeResponse(stdout, {
    id: 2,
    result: {
      thread: { id: "codex-thread-1" },
    },
  });

  await expect(rollback).resolves.toEqual({
    thread: { id: "codex-thread-1" },
  });
  const written = stdin.read()?.toString() ?? "";
  const lines = written
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  expect(lines).toEqual([
    {
      id: 1,
      method: "thread/read",
      params: { threadId: "codex-thread-1", includeTurns: true },
    },
    {
      id: 2,
      method: CODEX_ROLLBACK_METHOD,
      params: {
        threadId: "codex-thread-1",
        numTurns: 2,
      },
    },
  ]);
});

test("rollbackCodexThread uses the persisted user-turn ordinal when app-server rebuilds item ids", async () => {
  const requests: Array<{ method: string; params: unknown }> = [];
  const client = {
    request: async (method: string, params: unknown) => {
      requests.push({ method, params });
      if (method === "thread/read") {
        return {
          thread: {
            turns: [
              { items: [{ type: "userMessage", id: "item-1", clientId: null }] },
              { items: [{ type: "userMessage", id: "item-3", clientId: null }] },
              { items: [{ type: "userMessage", id: "item-5", clientId: null }] },
            ],
          },
        };
      }
      return { thread: { id: "codex-thread-1" } };
    },
  };
  await rollbackCodexThread(client as never, {
    threadId: "codex-thread-1",
    itemId: "eco-uuid-2",
    targetTurnIndex: 1,
  });
  expect(requests[1]).toEqual({
    method: CODEX_ROLLBACK_METHOD,
    params: { threadId: "codex-thread-1", numTurns: 2 },
  });
});

test("rollbackCodexThread reports a bounded diagnostic when the target is absent", async () => {
  const client = {
    request: async () => ({
      thread: {
        turns: [
          { items: [{ type: "userMessage", id: "item-1" }] },
          { items: [{ type: "agentMessage", id: "item-2" }] },
          { items: [{ type: "userMessage", id: "item-3" }] },
        ],
      },
    }),
  };

  await expect(
    rollbackCodexThread(client as never, {
      threadId: "codex-thread-1",
      itemId: "missing-item",
    }),
  ).rejects.toThrow("not found among 2 persisted user items");
});
