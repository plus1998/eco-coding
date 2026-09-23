import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { ConversationV2Store } from "../src/main/conversation-v2-store";

interface CorrectionOutput {
  phase: string;
  duplicate: boolean;
  event: { eventId: string; type: string; seq: number };
  effect: { seq: number; effect: { type: string; run: { status: string } } };
  integrity: { headSeq: number; eventCount: number; effectCount: number };
}

async function runCorrection(args: string[]): Promise<{
  code: number;
  stdout: string;
  stderr: string;
}> {
  const command = Bun.spawn(
    [
      process.execPath,
      fileURLToPath(new URL("../scripts/conversation-v2-correct-run.ts", import.meta.url)),
      ...args,
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const [stdout, stderr, code] = await Promise.all([
    new Response(command.stdout).text(),
    new Response(command.stderr).text(),
    command.exited,
  ]);
  return { code, stdout, stderr };
}

test("V2-only run correction CLI appends an audited repair and stays idempotent", async () => {
  const dir = await mkdtemp(join(tmpdir(), "eco-v2-correct-run-cli-"));
  const filename = join(dir, "conversation.sqlite");
  const conversationId = "thread_cli_correction";
  const runId = "run_cli_correction";
  const correctionArgs = [
    "--db",
    filename,
    "--conversation",
    conversationId,
    "--run",
    runId,
    "--actor",
    "admin:maintenance",
    "--reason",
    "repair the stale terminal status after provider reconciliation",
    "--expected-status",
    "completed",
    "--status",
    "failed",
    "--ended-at",
    "2026-09-19T00:00:04.000Z",
    "--timing-quality",
    "recorded",
  ];
  try {
    const db = new DatabaseSync(filename);
    const store = new ConversationV2Store(db, {
      now: () => "2026-09-19T00:00:05.000Z",
      idFactory: () => "cli_correction_id",
    });
    store.initialize();
    store.append({
      conversationId,
      eventId: "cli_correction_started",
      type: "run.started",
      occurredAt: "2026-09-19T00:00:01.000Z",
      turnId: "turn_cli_correction",
      runId,
      payload: { status: "running", startedAt: "2026-09-19T00:00:01.000Z" },
    });
    store.append({
      conversationId,
      eventId: "cli_correction_completed",
      type: "run.completed",
      occurredAt: "2026-09-19T00:00:03.000Z",
      turnId: "turn_cli_correction",
      runId,
      payload: { status: "completed", endedAt: "2026-09-19T00:00:03.000Z" },
    });
    db.exec("BEGIN IMMEDIATE");
    store.setStorageModeInCurrentTransaction("v2_only");
    db.exec("COMMIT");
    db.close();

    const first = await runCorrection(correctionArgs);
    expect({ code: first.code, stderr: first.stderr }).toEqual({ code: 0, stderr: "" });
    const firstOutput = JSON.parse(first.stdout) as CorrectionOutput;
    expect(firstOutput).toMatchObject({
      phase: "run_correction",
      duplicate: false,
      event: { type: "run.corrected", seq: 3 },
      effect: { seq: 3, effect: { type: "run.upsert", run: { status: "failed" } } },
      integrity: { headSeq: 3, eventCount: 3, effectCount: 3 },
    });

    const duplicate = await runCorrection(correctionArgs);
    expect({ code: duplicate.code, stderr: duplicate.stderr }).toEqual({ code: 0, stderr: "" });
    expect(JSON.parse(duplicate.stdout)).toMatchObject({
      phase: "run_correction",
      duplicate: true,
      event: { eventId: firstOutput.event.eventId, type: "run.corrected", seq: 3 },
      integrity: { headSeq: 3, eventCount: 3, effectCount: 3 },
    });

    const stale = await runCorrection(
      correctionArgs.map((value, index) =>
        index === correctionArgs.indexOf("--expected-status") + 1 ? "running" : value,
      ),
    );
    expect(stale.code).not.toBe(0);
    expect(stale.stderr).toContain("expected running");

    const reopened = new DatabaseSync(filename);
    const reopenedStore = new ConversationV2Store(reopened);
    reopenedStore.initialize();
    expect(reopenedStore.getStorageMode()).toBe("v2_only");
    expect(reopenedStore.getRun(conversationId, runId)).toMatchObject({ status: "failed" });
    expect(
      reopened
        .prepare(`SELECT COUNT(*) AS count FROM conversation_events_v2 WHERE type = 'run.corrected'`)
        .get(),
    ).toEqual({ count: 1 });
    reopened.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("V2-only run correction CLI rejects legacy-compatible stores before writing", async () => {
  const dir = await mkdtemp(join(tmpdir(), "eco-v2-correct-run-legacy-"));
  const filename = join(dir, "conversation.sqlite");
  try {
    const db = new DatabaseSync(filename);
    const store = new ConversationV2Store(db);
    store.initialize();
    store.append({
      conversationId: "thread_legacy_correction",
      eventId: "legacy_correction_started",
      type: "run.started",
      occurredAt: "2026-09-19T00:00:01.000Z",
      turnId: "turn_legacy_correction",
      runId: "run_legacy_correction",
      payload: { status: "running" },
    });
    db.close();

    const result = await runCorrection([
      "--db",
      filename,
      "--conversation",
      "thread_legacy_correction",
      "--run",
      "run_legacy_correction",
      "--actor",
      "admin:maintenance",
      "--reason",
      "must be blocked before cutover",
      "--expected-status",
      "running",
      "--status",
      "failed",
    ]);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("V2-only");

    const reopened = new DatabaseSync(filename);
    expect(reopened.prepare(`SELECT COUNT(*) AS count FROM conversation_events_v2`).get()).toEqual({
      count: 1,
    });
    reopened.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
