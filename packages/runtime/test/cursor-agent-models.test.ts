import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import {
  buildCursorAgentCliEnv,
  listCursorAgentModels,
  parseCursorAgentModelsOutput,
} from "../src/cursor-agent-models.js";

describe("buildCursorAgentCliEnv", () => {
  test("merges caller env over process env and injects CURSOR_API_KEY when present", () => {
    const env = buildCursorAgentCliEnv({ CUSTOM_VAR: "x" }, "  ck-test-123  ");
    expect(env.CURSOR_API_KEY).toBe("ck-test-123");
    expect(env.CUSTOM_VAR).toBe("x");
    expect(env.HOME ?? env.USERPROFILE).toBe(process.env.HOME ?? process.env.USERPROFILE);
  });

  test("leaves CURSOR_API_KEY untouched for blank or absent keys", () => {
    const withBlank = buildCursorAgentCliEnv(undefined, "   ");
    const without = buildCursorAgentCliEnv(undefined);
    for (const env of [withBlank, without]) {
      expect(env.CURSOR_API_KEY).toBe(process.env.CURSOR_API_KEY);
    }
  });
});

describe("listCursorAgentModels", () => {
  test("regression: partial per-call env (just CURSOR_API_KEY) must not hide process.env for spawn", async () => {
    const calls: Array<{
      file: string;
      options: import("node:child_process").SpawnOptions;
    }> = [];
    const fakeChild = new EventEmitter() as ChildProcess;
    const stdout = new EventEmitter();
    fakeChild.stdout = stdout;
    fakeChild.stderr = new EventEmitter();

    const spawnFn = ((
      file: string,
      args: readonly string[],
      options: import("node:child_process").SpawnOptions,
    ) => {
      calls.push({ file, options });
      setImmediate(() => {
        stdout.emit("data", "Available models\nauto - Auto (current, default)\n");
        fakeChild.emit("close", 0);
      });
      return fakeChild;
    }) as import("../src/cursor-agent-models.js").CursorAgentModelListOptions["spawnFn"];

    const models = await listCursorAgentModels({
      executable: "/bin/eco-fake-agent",
      env: { CURSOR_API_KEY: "ck-test-123" },
      spawnFn,
    });

    expect(models).toEqual([
      { id: "auto", displayName: "Auto", current: true, default: true },
    ]);
    expect(calls).toHaveLength(1);
    // The spawned env must be process.env merged with the partial override —
    // a bare { CURSOR_API_KEY } env broke executable discovery on Windows.
    const env = calls[0]!.options.env as NodeJS.ProcessEnv;
    expect(env.CURSOR_API_KEY).toBe("ck-test-123");
    expect(env.PATH).toBe(process.env.PATH);
    expect(env.HOME ?? env.USERPROFILE ?? env.LOCALAPPDATA).toBe(
      process.env.HOME ?? process.env.USERPROFILE ?? process.env.LOCALAPPDATA,
    );
  });
});

describe("listCursorAgentModels helpers", () => {
  test("parses the account-owned CLI model catalog", () => {
    expect(
      parseCursorAgentModelsOutput(
        "Available models\n\nauto - Auto (current, default)\ngpt-5.3-codex - Codex 5.3\n\u001b[2mTip: use --model <id>\u001b[0m\n",
      ),
    ).toEqual([
      { id: "auto", displayName: "Auto", current: true, default: true },
      { id: "gpt-5.3-codex", displayName: "Codex 5.3", current: false, default: false },
    ]);
  });
});
