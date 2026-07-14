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
    }),
  ).toEqual({
    threadId: "codex-thread-1",
    itemId: "item-user-2",
  });
});

test("buildCodexThreadRollbackParams rejects missing target without fallback", () => {
  expect(() =>
    buildCodexThreadRollbackParams({
      threadId: "codex-thread-1",
      itemId: " ",
    }),
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
      thread: { id: "codex-thread-1" },
      rolledBackToItemId: "item-user-2",
    },
  });

  await expect(rollback).resolves.toEqual({
    thread: { id: "codex-thread-1" },
    rolledBackToItemId: "item-user-2",
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
      method: CODEX_ROLLBACK_METHOD,
      params: {
        threadId: "codex-thread-1",
        itemId: "item-user-2",
      },
    },
  ]);
});
