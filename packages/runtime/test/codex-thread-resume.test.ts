import { expect, test } from "bun:test";
import { PassThrough } from "node:stream";
import { CodexAppServerClient } from "../src/codex-app-server-client";
import type { CodexResumeDiagnostic } from "../src/codex-thread-resume";
import {
  buildCodexSubagentFollowupPrompt,
  buildCodexThreadResumeParams,
  CODEX_RESUME_METHOD,
  CODEX_THREAD_READ_METHOD,
  CodexResumeNotAvailable,
  isCodexThreadStatusTerminal,
  parseCodexThreadStatus,
  readCodexThreadStatus,
  requireCodexSubagentThreadId,
  resumeCodexThread,
} from "../src/codex-thread-resume";

function writeResponse(stdout: PassThrough, message: unknown): void {
  stdout.write(`${JSON.stringify(message)}\n`);
}

test("buildCodexThreadResumeParams trims and locks request shape", () => {
  expect(
    buildCodexThreadResumeParams({
      threadId: " codex-thread-1 ",
      cwd: " /repo ",
      model: " claude-sonnet-4 ",
      modelProvider: " eco_main ",
      developerInstructions: " Keep Eco orchestration guidance. ",
      config: { mcp_servers: { browser: { enabled: false } } },
    }),
  ).toEqual({
    threadId: "codex-thread-1",
    cwd: "/repo",
    model: "claude-sonnet-4",
    modelProvider: "eco_main",
    developerInstructions: "Keep Eco orchestration guidance.",
    config: { mcp_servers: { browser: { enabled: false } } },
  });
});

test("buildCodexThreadResumeParams rejects missing thread id without fallback", () => {
  expect(() => buildCodexThreadResumeParams({ threadId: "  " })).toThrow(CodexResumeNotAvailable);
});

test("resumeCodexThread applies config only when thread/read proves notLoaded", async () => {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const client = new CodexAppServerClient(stdin, stdout);

  const resume = resumeCodexThread(client, {
    threadId: "codex-thread-1",
    cwd: "/repo",
    config: { mcp_servers: { browser: { enabled: false } } },
  });
  await Bun.sleep(0);
  writeResponse(stdout, {
    id: 1,
    result: { thread: { id: "codex-thread-1", status: { type: "notLoaded" } } },
  });
  await Bun.sleep(0);
  writeResponse(stdout, {
    id: 2,
    result: {
      thread: { id: "codex-thread-1", status: { type: "idle" } },
    },
  });

  await expect(resume).resolves.toEqual({
    thread: { id: "codex-thread-1", status: { type: "idle" } },
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
      method: CODEX_THREAD_READ_METHOD,
      params: {
        threadId: "codex-thread-1",
        includeTurns: false,
      },
    },
    {
      id: 2,
      method: CODEX_RESUME_METHOD,
      params: {
        threadId: "codex-thread-1",
        cwd: "/repo",
        config: { mcp_servers: { browser: { enabled: false } } },
      },
    },
  ]);
});

test("resumeCodexThread refuses configured idle resume because config reload is not provable", async () => {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const client = new CodexAppServerClient(stdin, stdout);

  const diagnostics: CodexResumeDiagnostic[] = [];
  const resume = resumeCodexThread(client, {
    threadId: "codex-thread-idle",
    config: { mcp_servers: {} },
    onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
  });
  await Bun.sleep(0);
  writeResponse(stdout, {
    id: 1,
    result: { thread: { id: "codex-thread-idle", status: { type: "idle" } } },
  });

  await expect(resume).rejects.toThrow(/Restart the Codex app-server/);
  expect(stdin.read()?.toString()).not.toContain(CODEX_RESUME_METHOD);
  expect(diagnostics).toHaveLength(1);
  expect(diagnostics[0]).toMatchObject({
    threadId: "codex-thread-idle",
    clientInstanceId: client.diagnosticInstanceId,
    clientGeneration: 0,
    configAlreadyApplied: false,
    status: "idle",
    decision: "reject_loaded_config",
  });
  expect(diagnostics[0]?.nextConfigFingerprint).toMatch(/^[a-f0-9]{64}$/);
});

test("resumeCodexThread refuses configured resume while the loaded thread is active", async () => {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const client = new CodexAppServerClient(stdin, stdout);

  const diagnostics: CodexResumeDiagnostic[] = [];
  const resume = resumeCodexThread(client, {
    threadId: "codex-thread-active",
    config: { mcp_servers: {} },
    onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
  });
  await Bun.sleep(0);
  writeResponse(stdout, {
    id: 1,
    result: { thread: { id: "codex-thread-active", status: { type: "active", activeFlags: [] } } },
  });

  await expect(resume).rejects.toThrow(CodexResumeNotAvailable);
  expect(stdin.read()?.toString()).not.toContain(CODEX_RESUME_METHOD);
  expect(diagnostics[0]).toMatchObject({
    status: "active",
    activeFlags: [],
    decision: "reject_loaded_config",
  });
});

test("requireCodexSubagentThreadId returns agent id when attribution exists", () => {
  const attributions = new Map([
    ["thr_codex_child", { parentThreadId: "thr_codex_parent", agentRole: "explore" }],
  ]);
  expect(requireCodexSubagentThreadId((id) => attributions.get(id), " thr_codex_child ")).toBe(
    "thr_codex_child",
  );
});

test("requireCodexSubagentThreadId rejects missing attribution without inventing a thread", () => {
  expect(() => requireCodexSubagentThreadId(() => undefined, "thr_missing")).toThrow(CodexResumeNotAvailable);
  expect(() => requireCodexSubagentThreadId(() => undefined, "thr_missing")).toThrow(
    /no Codex thread attribution mapping/,
  );
});

test("requireCodexSubagentThreadId rejects empty agent id", () => {
  expect(() => requireCodexSubagentThreadId(() => undefined, "  ")).toThrow(CodexResumeNotAvailable);
});

test("buildCodexSubagentFollowupPrompt forwards only the user task", () => {
  expect(buildCodexSubagentFollowupPrompt("thr_child", "finish the auth audit")).toBe(
    "finish the auth audit",
  );
});

test("parseCodexThreadStatus and terminal classification", () => {
  expect(parseCodexThreadStatus({ type: "idle" })).toBe("idle");
  expect(parseCodexThreadStatus({ type: "active", activeFlags: [] })).toBe("active");
  expect(parseCodexThreadStatus({ type: "systemError" })).toBe("systemError");
  expect(parseCodexThreadStatus(null)).toBe("unknown");
  expect(isCodexThreadStatusTerminal("idle")).toBe(true);
  expect(isCodexThreadStatusTerminal("active")).toBe(false);
});

test("readCodexThreadStatus sends thread/read without turns", async () => {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const client = new CodexAppServerClient(stdin, stdout);

  const status = readCodexThreadStatus(client, "codex-thread-1");
  await Bun.sleep(0);
  writeResponse(stdout, {
    id: 1,
    result: { thread: { id: "codex-thread-1", status: { type: "active", activeFlags: [] } } },
  });

  await expect(status).resolves.toBe("active");
  const written = stdin.read()?.toString() ?? "";
  const lines = written
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  expect(lines).toEqual([
    {
      id: 1,
      method: CODEX_THREAD_READ_METHOD,
      params: {
        threadId: "codex-thread-1",
        includeTurns: false,
      },
    },
  ]);
});
