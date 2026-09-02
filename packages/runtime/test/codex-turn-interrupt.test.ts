import { expect, test } from "bun:test";
import { PassThrough } from "node:stream";
import { CodexAppServerClient } from "../src/codex-app-server-client";
import {
  buildCodexTurnInterruptParams,
  CODEX_TURN_INTERRUPT_METHOD,
  CodexTurnInterruptFailed,
  interruptCodexTurn,
  isCodexTurnInterruptFailed,
} from "../src/codex-turn-interrupt";
import { drainPassThroughText, parseJsonLines } from "./codex-mock-transport";

function writeResponse(stdout: PassThrough, message: unknown): void {
  stdout.write(`${JSON.stringify(message)}\n`);
}

test("buildCodexTurnInterruptParams trims and locks request shape", () => {
  expect(
    buildCodexTurnInterruptParams({
      threadId: " thr_codex_1 ",
      turnId: " turn_1 ",
    }),
  ).toEqual({
    threadId: "thr_codex_1",
    turnId: "turn_1",
  });
});

test("buildCodexTurnInterruptParams rejects missing ids without fallback", () => {
  expect(() =>
    buildCodexTurnInterruptParams({
      threadId: "thr_codex_1",
      turnId: " ",
    }),
  ).toThrow(CodexTurnInterruptFailed);
});

test("interruptCodexTurn sends turn/interrupt to the app-server client", async () => {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const client = new CodexAppServerClient(stdin, stdout);

  const interrupt = interruptCodexTurn(client, {
    threadId: "thr_codex_1",
    turnId: "turn_1",
  });
  await Bun.sleep(0);
  writeResponse(stdout, { id: 1, result: {} });

  await expect(interrupt).resolves.toEqual({});
  const lines = parseJsonLines(drainPassThroughText(stdin)) as Array<{
    method?: string;
    params?: Record<string, unknown>;
  }>;
  expect(lines).toEqual([
    {
      id: 1,
      method: CODEX_TURN_INTERRUPT_METHOD,
      params: { threadId: "thr_codex_1", turnId: "turn_1" },
    },
  ]);
});

test("interruptCodexTurn surfaces RPC failure as CodexTurnInterruptFailed", async () => {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const client = new CodexAppServerClient(stdin, stdout);

  const interrupt = interruptCodexTurn(client, {
    threadId: "thr_codex_1",
    turnId: "turn_1",
  });
  await Bun.sleep(0);
  writeResponse(stdout, {
    id: 1,
    error: { code: -32600, message: "turn not active" },
  });

  try {
    await interrupt;
    expect.unreachable("expected interrupt to fail");
  } catch (error) {
    expect(error).toBeInstanceOf(CodexTurnInterruptFailed);
    expect(String(error)).toMatch(/turn\/interrupt failed/);
  }
});

test("isCodexTurnInterruptFailed identifies interrupt failures only", () => {
  expect(isCodexTurnInterruptFailed(new CodexTurnInterruptFailed("x"))).toBe(true);
  expect(isCodexTurnInterruptFailed(new Error("aborted"))).toBe(false);
});
