import { afterEach, describe, expect, mock, test } from "bun:test";
import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  resolveCursorAgentExecutable,
  spawnCursorAcpProcess,
} from "../src/acp-cursor-agent.js";

const TEST_TMP = path.join(path.dirname(fileURLToPath(import.meta.url)), ".tmp-acp-agent");

describe("resolveCursorAgentExecutable", () => {
  let tempRoot: string | undefined;

  afterEach(() => {
    if (tempRoot) {
      rmSync(tempRoot, { recursive: true, force: true });
      tempRoot = undefined;
    }
    mock.restore();
  });

  test("prefers explicit path over env and HOME candidates", () => {
    expect(
      resolveCursorAgentExecutable("/explicit/agent", {
        env: { CURSOR_AGENT_EXECUTABLE: "/from/env/agent", HOME: "/home/x" },
      }),
    ).toBe("/explicit/agent");
  });

  test("uses CURSOR_AGENT_EXECUTABLE when set", () => {
    expect(
      resolveCursorAgentExecutable(undefined, {
        env: { CURSOR_AGENT_EXECUTABLE: "/from/env/agent" },
      }),
    ).toBe("/from/env/agent");
  });

  test("resolves ~/.local/bin/agent then ~/.cursor/bin/agent before bare agent", () => {
    mkdirSync(TEST_TMP, { recursive: true });
    tempRoot = mkdtempSync(path.join(TEST_TMP, "home-"));
    const env = { HOME: tempRoot } as NodeJS.ProcessEnv;

    const localAgent = path.join(tempRoot, ".local", "bin", "agent");
    mkdirSync(path.dirname(localAgent), { recursive: true });
    writeFileSync(localAgent, "#!/bin/sh\n");
    expect(resolveCursorAgentExecutable(undefined, { env })).toBe(localAgent);

    const cursorAgent = path.join(tempRoot, ".cursor", "bin", "agent");
    // Avoid mkdir(".cursor") — sandbox EPERM; inject existsSync instead.
    expect(
      resolveCursorAgentExecutable(undefined, {
        env,
        existsSync: (p) => p === cursorAgent,
      }),
    ).toBe(cursorAgent);

    expect(
      resolveCursorAgentExecutable(undefined, {
        env,
        existsSync: () => false,
      }),
    ).toBe("agent");
  });
});

describe("spawnCursorAcpProcess", () => {
  afterEach(() => {
    mock.restore();
  });

  test("spawns with args [\"acp\"] and never --print", () => {
    const calls: Array<{ file: string; args: string[] }> = [];
    const fakeChild = new EventEmitter() as ChildProcess;
    fakeChild.stdin = null;
    fakeChild.stdout = null;
    fakeChild.stderr = null;

    const spawnFn = ((file: string, args: string[]) => {
      calls.push({ file, args: [...args] });
      return fakeChild;
    }) as typeof import("node:child_process").spawn;

    const child = spawnCursorAcpProcess({
      executable: "/bin/eco-fake-agent",
      cwd: "/tmp/ws",
      spawnFn,
    });

    expect(child).toBe(fakeChild);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.file).toBe("/bin/eco-fake-agent");
    expect(calls[0]?.args).toEqual(["acp"]);
    expect(calls[0]?.args).not.toContain("--print");
    expect(calls[0]?.args.some((a) => a.includes("stream-json"))).toBe(false);
  });
});
