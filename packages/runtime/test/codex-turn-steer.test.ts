import { expect, test } from "bun:test";
import { PassThrough } from "node:stream";
import { CodexAppServerClient } from "../src/codex-app-server-client";
import {
  buildCodexTurnSteerParams,
  CODEX_TURN_STEER_DEADLINE_MS,
  CODEX_TURN_STEER_METHOD,
  CodexTurnSteerFailed,
  isCodexTurnSteerFailed,
  steerCodexTurn,
} from "../src/codex-turn-steer";
import { drainPassThroughText, parseJsonLines } from "./codex-mock-transport";

function writeResponse(stdout: PassThrough, message: unknown): void {
  stdout.write(`${JSON.stringify(message)}\n`);
}

test("buildCodexTurnSteerParams trims and wires expectedTurnId + clientUserMessageId", () => {
  expect(
    buildCodexTurnSteerParams({
      threadId: " thr_codex_1 ",
      turnId: " turn_1 ",
      input: [{ type: "text", text: "  steer me  " }],
      clientUserMessageId: " tfu_1 ",
    }),
  ).toEqual({
    threadId: "thr_codex_1",
    expectedTurnId: "turn_1",
    input: [{ type: "text", text: "steer me" }],
    clientUserMessageId: "tfu_1",
  });
});

test("buildCodexTurnSteerParams rejects empty input without fallback", () => {
  expect(() =>
    buildCodexTurnSteerParams({
      threadId: "thr_codex_1",
      turnId: "turn_1",
      input: [],
    }),
  ).toThrow(CodexTurnSteerFailed);
});

test("steerCodexTurn sends turn/steer to the app-server client", async () => {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const client = new CodexAppServerClient(stdin, stdout);

  const steer = steerCodexTurn(client, {
    threadId: "thr_codex_1",
    turnId: "turn_1",
    input: [{ type: "text", text: "hello mid-turn" }],
    clientUserMessageId: "tfu_mid",
  });
  await Bun.sleep(0);
  writeResponse(stdout, { id: 1, result: { turnId: "turn_1" } });

  await expect(steer).resolves.toEqual({ turnId: "turn_1" });
  const lines = parseJsonLines(drainPassThroughText(stdin)) as Array<{
    method?: string;
    params?: Record<string, unknown>;
  }>;
  expect(lines).toEqual([
    {
      id: 1,
      method: CODEX_TURN_STEER_METHOD,
      params: {
        threadId: "thr_codex_1",
        expectedTurnId: "turn_1",
        input: [{ type: "text", text: "hello mid-turn" }],
        clientUserMessageId: "tfu_mid",
      },
    },
  ]);
});

test("steerCodexTurn surfaces RPC failure as CodexTurnSteerFailed", async () => {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const client = new CodexAppServerClient(stdin, stdout);

  const steer = steerCodexTurn(client, {
    threadId: "thr_codex_1",
    turnId: "turn_1",
    input: [{ type: "text", text: "x" }],
  });
  await Bun.sleep(0);
  writeResponse(stdout, {
    id: 1,
    error: { code: -32600, message: "no active turn" },
  });

  try {
    await steer;
    expect.unreachable("steer should fail");
  } catch (error) {
    expect(isCodexTurnSteerFailed(error)).toBe(true);
    expect((error as CodexTurnSteerFailed).deliveryUnknown).toBe(false);
    expect(String(error)).toContain("no active turn");
  }
});

test("steerCodexTurn uses a short control deadline and marks transport failures unknown", async () => {
  let timeoutMs: number | undefined;
  const client = {
    async request(_method: string, _params: unknown, options?: { timeoutMs?: number }) {
      timeoutMs = options?.timeoutMs;
      throw new Error("Timed out waiting for turn/steer response");
    },
  } as unknown as Pick<CodexAppServerClient, "request">;

  try {
    await steerCodexTurn(client, {
      threadId: "thr_codex_1",
      turnId: "turn_1",
      input: [{ type: "text", text: "x" }],
    });
    expect.unreachable("steer should fail");
  } catch (error) {
    expect(timeoutMs).toBe(CODEX_TURN_STEER_DEADLINE_MS);
    expect(isCodexTurnSteerFailed(error)).toBe(true);
    expect((error as CodexTurnSteerFailed).deliveryUnknown).toBe(true);
  }
});
