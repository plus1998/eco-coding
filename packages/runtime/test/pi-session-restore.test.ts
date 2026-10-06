import { expect, test } from "bun:test";
import { copyFile, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ensurePiSessionsDir } from "../src/pi-session-paths";
import { runScriptedPiSession } from "./pi-session-events-probe";

/**
 * A conversation JSONL written by PI 0.85.1 (2026-09-23), vendored verbatim from
 * a real dev session. The upgrade must keep restoring it: the file is the only
 * artifact an existing user's running thread has, so a format break would strand
 * every in-flight conversation rather than merely fail a new one.
 */
const FIXTURE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "pi-session-v3-pre-1.0.jsonl",
);
const FIXTURE_USER_PROMPT = "你正在执行自动验收。你唯一要做的事是调用 Bash 一次。";
const FIXTURE_TOOL_OUTPUT = "V2_LONGCAT_FULL_MUEC33LI_PI_TOOL";

function messageTexts(messages: unknown[]): string {
  return JSON.stringify(messages);
}

test("a session written before the upgrade is restored and keeps its history", async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), "eco-pi-restore-ws-"));
  const agentDir = await mkdtemp(path.join(tmpdir(), "eco-pi-restore-agent-"));
  const sessionsDir = await ensurePiSessionsDir(agentDir);
  const sessionFile = path.join(sessionsDir, "2026-09-23T16-45-07-863Z_01a0cf28.jsonl");
  await copyFile(FIXTURE, sessionFile);

  const result = await runScriptedPiSession({
    workspace,
    agentDir,
    threadId: "thr_restore_pre_1_0",
    sessionFile,
    turns: [{ text: "restored" }],
  });
  try {
    expect(result.requests.length).toBeGreaterThan(0);
    const firstRequest = result.requests[0];
    const history = messageTexts(firstRequest?.messages ?? []);
    // The old turns are on the wire, not dropped by a version guard.
    expect(history).toContain(FIXTURE_USER_PROMPT);
    expect(history).toContain(FIXTURE_TOOL_OUTPUT);
    // And the resumed session kept its identity rather than being replaced.
    const captured = result.events.find((event) => event.type === "session.captured");
    expect((captured?.payload as { sessionFile?: string })?.sessionFile).toBe(sessionFile);
  } finally {
    await result.dispose();
  }
}, 60_000);

test("a fresh prompt in a restored pre-upgrade session is answered normally", async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), "eco-pi-restore2-ws-"));
  const agentDir = await mkdtemp(path.join(tmpdir(), "eco-pi-restore2-agent-"));
  const sessionsDir = await ensurePiSessionsDir(agentDir);
  const sessionFile = path.join(sessionsDir, "restored.jsonl");
  await copyFile(FIXTURE, sessionFile);
  // The workspace the old session recorded does not exist any more; PI must not
  // depend on it to reopen the conversation.
  await mkdir(workspace, { recursive: true });
  await writeFile(path.join(workspace, "sentinel.txt"), "ok", "utf8");

  const result = await runScriptedPiSession({
    workspace,
    agentDir,
    threadId: "thr_restore_pre_1_0_continue",
    sessionFile,
    turns: [{ text: "continued after restore" }],
  });
  try {
    // The new turn ran to completion against the restored conversation.
    expect(result.events.some((event) => event.type === "agent.settled")).toBe(true);
    expect(result.turnCount).toBe(1);
  } finally {
    await result.dispose();
  }
}, 60_000);
