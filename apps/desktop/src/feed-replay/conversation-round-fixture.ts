import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateCodexRecordingScenarioChecklist } from "./replay-scenario-checklist";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

export interface RpcLogEntry {
  seq?: number;
  ts?: string;
  kind?: string;
  method?: string;
  params?: Record<string, unknown>;
}

export interface ConversationRoundFixture {
  dir: string;
  runId: string;
  marker: string;
  rpcLog: RpcLogEntry[];
  summary: Record<string, unknown>;
  meta: Record<string, unknown>;
  workspaceFiles: Record<string, string>;
  skillsListResult: unknown;
  prompt: string;
}

export function resolveConversationRoundFixtureDir(configured?: string): string {
  const explicit = configured?.trim() || process.env.ECO_CONVERSATION_ROUND_FIXTURE?.trim();
  if (explicit) {
    if (path.isAbsolute(explicit) && existsSync(explicit)) {
      return explicit;
    }
    const underRound = path.join(repoRoot, "scripts/conversation-round/fixtures", explicit);
    if (existsSync(underRound)) {
      return underRound;
    }
    const underSmoke = path.join(repoRoot, "scripts/codex-scenario-smoke/fixtures", explicit);
    if (existsSync(underSmoke)) {
      return underSmoke;
    }
    if (existsSync(path.resolve(explicit))) {
      return path.resolve(explicit);
    }
    throw new Error(`Conversation round fixture not found: ${explicit}`);
  }

  for (const pointerPath of [
    path.join(repoRoot, "scripts/conversation-round/fixtures/latest.json"),
    path.join(repoRoot, "scripts/codex-scenario-smoke/fixtures/latest.json"),
  ]) {
    if (!existsSync(pointerPath)) {
      continue;
    }
    const pointer = JSON.parse(readFileSync(pointerPath, "utf8")) as {
      path?: string;
      runId?: string;
    };
    const dir =
      pointer.path && existsSync(pointer.path)
        ? pointer.path
        : pointer.runId
          ? path.join(path.dirname(pointerPath), pointer.runId)
          : undefined;
    if (dir && existsSync(dir)) {
      return dir;
    }
  }

  throw new Error(
    "No conversation round fixture found. Run: LONGCAT_API_KEY=... bun scripts/conversation-round/record.mjs",
  );
}

export function loadConversationRoundFixture(
  fixtureDir = resolveConversationRoundFixtureDir(),
): ConversationRoundFixture {
  const rpcPath = path.join(fixtureDir, "rpc-log.jsonl");
  if (!existsSync(rpcPath)) {
    throw new Error(`Missing rpc-log.jsonl in ${fixtureDir}`);
  }
  const rpcLog = readFileSync(rpcPath, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as RpcLogEntry);

  const summary = existsSync(path.join(fixtureDir, "summary.json"))
    ? (JSON.parse(readFileSync(path.join(fixtureDir, "summary.json"), "utf8")) as Record<string, unknown>)
    : {};
  const meta = existsSync(path.join(fixtureDir, "meta.json"))
    ? (JSON.parse(readFileSync(path.join(fixtureDir, "meta.json"), "utf8")) as Record<string, unknown>)
    : {};
  const workspaceFiles = existsSync(path.join(fixtureDir, "workspace-files.json"))
    ? (JSON.parse(readFileSync(path.join(fixtureDir, "workspace-files.json"), "utf8")) as Record<
        string,
        string
      >)
    : {};
  const skillsListResult = existsSync(path.join(fixtureDir, "skills-list.json"))
    ? JSON.parse(readFileSync(path.join(fixtureDir, "skills-list.json"), "utf8"))
    : undefined;
  const prompt = existsSync(path.join(fixtureDir, "prompt.txt"))
    ? readFileSync(path.join(fixtureDir, "prompt.txt"), "utf8")
    : "";

  const marker =
    (typeof summary.marker === "string" && summary.marker) ||
    (typeof meta.marker === "string" && meta.marker) ||
    "";
  const runId =
    (typeof summary.runId === "string" && summary.runId) ||
    (typeof meta.runId === "string" && meta.runId) ||
    path.basename(fixtureDir);

  if (!marker) {
    throw new Error(`Fixture ${fixtureDir} is missing marker in summary.json/meta.json`);
  }

  return {
    dir: fixtureDir,
    runId,
    marker,
    rpcLog,
    summary,
    meta,
    workspaceFiles,
    skillsListResult,
    prompt,
  };
}

export function evaluateFixtureScenarioChecklist(fixture: ConversationRoundFixture) {
  return evaluateCodexRecordingScenarioChecklist({
    rpcLog: fixture.rpcLog,
    workspaceFiles: fixture.workspaceFiles,
    marker: fixture.marker,
    skillsListResult: fixture.skillsListResult,
  });
}

export function extractNotificationLines(fixture: ConversationRoundFixture): string {
  return fixture.rpcLog
    .filter((entry) => entry.kind === "notification" && typeof entry.method === "string")
    .map((entry) => JSON.stringify({ method: entry.method, params: entry.params ?? {} }))
    .join("\n");
}
