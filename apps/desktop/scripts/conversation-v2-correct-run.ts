import { DatabaseSync } from "node:sqlite";
import { type ConversationRunCorrectionInput, ConversationV2Store } from "../src/main/conversation-v2-store";

interface Arguments {
  dbPath: string;
  conversationId: string;
  runId: string;
  actorPrincipalId: string;
  reason: string;
  expectedPreviousStatus: ConversationRunCorrectionInput["expectedPreviousStatus"];
  status: ConversationRunCorrectionInput["status"];
  startedAt?: string | null;
  endedAt?: string | null;
  timingQuality?: ConversationRunCorrectionInput["timingQuality"];
}

const args = parseArguments(process.argv.slice(2));
const db = new DatabaseSync(args.dbPath);
try {
  const store = new ConversationV2Store(db);
  store.initialize();
  if (store.getStorageMode() !== "v2_only") {
    throw new Error("run.corrected is only available after the V2-only cutover.");
  }
  const result = store.correctRun(args);
  const integrity = store.validateIntegrity(args.conversationId);
  process.stdout.write(
    `${JSON.stringify(
      {
        phase: "run_correction",
        duplicate: result.duplicate,
        event: result.event,
        effect: result.effect,
        integrity,
      },
      null,
      2,
    )}\n`,
  );
} finally {
  db.close();
}

function parseArguments(values: string[]): Arguments {
  let dbPath = "";
  let conversationId = "";
  let runId = "";
  let actorPrincipalId = "";
  let reason = "";
  let expectedPreviousStatus: ConversationRunCorrectionInput["expectedPreviousStatus"] | undefined;
  let status: ConversationRunCorrectionInput["status"] | undefined;
  let startedAt: string | null | undefined;
  let endedAt: string | null | undefined;
  let timingQuality: ConversationRunCorrectionInput["timingQuality"] | undefined;
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    const next = () => values[++index] ?? "";
    if (value === "--db") dbPath = next();
    else if (value === "--conversation") conversationId = next();
    else if (value === "--run") runId = next();
    else if (value === "--actor") actorPrincipalId = next();
    else if (value === "--reason") reason = next();
    else if (value === "--expected-status")
      expectedPreviousStatus = next() as Arguments["expectedPreviousStatus"];
    else if (value === "--status") status = next() as Arguments["status"];
    else if (value === "--started-at") startedAt = next();
    else if (value === "--clear-started-at") startedAt = null;
    else if (value === "--ended-at") endedAt = next();
    else if (value === "--clear-ended-at") endedAt = null;
    else if (value === "--timing-quality") timingQuality = next() as Arguments["timingQuality"];
    else if (value === "--help" || value === "-h") {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${value}`);
    }
  }
  const required: Array<[string, string]> = [
    ["--db", dbPath],
    ["--conversation", conversationId],
    ["--run", runId],
    ["--actor", actorPrincipalId],
    ["--reason", reason],
    ["--expected-status", expectedPreviousStatus ?? ""],
    ["--status", status ?? ""],
  ];
  for (const [flag, value] of required) {
    if (!value.trim()) {
      printUsage();
      throw new Error(`${flag} is required.`);
    }
  }
  if (startedAt !== undefined && startedAt !== null && !startedAt.trim()) {
    throw new Error("--started-at requires a non-empty timestamp.");
  }
  if (endedAt !== undefined && endedAt !== null && !endedAt.trim()) {
    throw new Error("--ended-at requires a non-empty timestamp.");
  }
  return {
    dbPath,
    conversationId,
    runId,
    actorPrincipalId,
    reason,
    expectedPreviousStatus,
    status,
    ...(startedAt !== undefined ? { startedAt } : {}),
    ...(endedAt !== undefined ? { endedAt } : {}),
    ...(timingQuality !== undefined ? { timingQuality } : {}),
  };
}

function printUsage(): void {
  process.stderr.write(
    "Usage: bun scripts/conversation-v2-correct-run.ts --db /path/eco-coding.sqlite --conversation THREAD_ID --run RUN_ID --actor PRINCIPAL --reason TEXT --expected-status STATUS --status STATUS [--started-at ISO | --clear-started-at] [--ended-at ISO | --clear-ended-at] [--timing-quality recorded|unknown|estimated]\n",
  );
}
